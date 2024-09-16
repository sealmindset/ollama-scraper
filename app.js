const express = require('express');
const puppeteer = require('puppeteer');
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const redis = require('redis');
const fs = require('fs');
const { parse } = require('json2csv'); // Import parse function from json2csv
const {
  extractDataWithOllama,
  fetchHTML,
  saveRawDataToRedis,
  getRawDataFromRedis,
  saveFormattedDataToRedis,
  getFormattedDataFromRedis,
} = require('./scraperUtils');
require('dotenv').config();

const app = express();

// Set up Redis connection using environment variables
const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Middleware to parse incoming requests and serve static files
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public')); // Serve static files from the public directory

// Function to scrape models from Ollama library and store them in Redis
async function scrapeAndStoreModels() {
  try {
    await redisClient.connect();

    // Launch Puppeteer to scrape the Ollama library page
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://ollama.com/library');

    // Extract model names from the page
    const models = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href^="/library/"]'))
        .map((link) => link.getAttribute('href').replace('/library/', ''))
        .filter((name) => name); // Filter out any empty strings
    });

    // Store the models list in Redis
    await redisClient.set('models', JSON.stringify(models));
    console.log('Models successfully stored in Redis:', models);

    // Close Puppeteer
    await browser.close();
    await redisClient.disconnect();
  } catch (error) {
    console.error('Error during scraping and storing models:', error);
  }
}

// Call the scraping function manually or schedule it
scrapeAndStoreModels(); // You can call this periodically as needed

// Endpoint to fetch models from Redis
app.get('/models', async (req, res) => {
  try {
    await redisClient.connect();

    // Fetch models from Redis
    const models = await redisClient.get('models');
    const modelsList = JSON.parse(models || '[]');

    res.json({ models: modelsList });

    await redisClient.disconnect();
  } catch (error) {
    console.error('Error fetching models from Redis:', error);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// Function to find the running Flask API port specifically at 11400
async function findFlaskPort() {
  console.log('Attempting to connect to Flask API on port 11400...');

  try {
    const response = await axios.post(
      'http://localhost:11400/ollama',
      {
        prompt: 'test',
        message: 'testing connection',
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000000,
      }
    );

    if (response.status === 200) {
      console.log(`Flask API found at port 11400`);
      return 11400;
    }
  } catch (error) {
    console.error(`Error connecting to Flask on port 11400:`, error.message);
    if (error.response) {
      console.error('Error response data:', error.response.data);
    } else if (error.request) {
      console.error('Error request details:', error.request);
    } else {
      console.error('Error message:', error.message);
    }
  }

  throw new Error('No available Flask API found at port 11400.');
}

// Render the main page
app.get('/', (req, res) => {
  res.render('index', { fields: [], data: {}, model: 'llama3.1', key: '' }); // Ensure default model is provided and key is empty
});

// Handle scraping request when the user submits the form
app.post('/scrape', async (req, res) => {
  const { model = 'llama3.1', url, fields } = req.body;

  if (!url) {
    console.error('Error: URL is missing in the form submission.');
    return res.status(400).send('URL is missing.');
  }

  const fieldsArray = fields ? fields.split(',').map((field) => field.trim()) : [];
  if (fieldsArray.length === 0) {
    console.error('Error: No fields specified for extraction.');
    return res.status(400).send('Fields are missing.');
  }

  try {
    const flaskPort = await findFlaskPort();

    // Fetch and clean the HTML content from the user-provided URL
    const htmlContent = await fetchHTML(url);

    // Save the raw HTML data to Redis with a unique timestamp key
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const redisKey = `raw_data_${timestamp}`;
    await saveRawDataToRedis(redisKey, htmlContent);

    // Retrieve the raw HTML data from Redis
    const savedHtmlContent = await getRawDataFromRedis(redisKey);

    // Extract relevant data using the selected model
    const extractedData = await extractDataWithOllama(savedHtmlContent, fieldsArray, model);

    // Save the formatted data for review in Redis
    const formattedDataKey = `formatted_data_${timestamp}`;
    await saveFormattedDataToRedis(formattedDataKey, extractedData);

    // Retrieve the formatted data from Redis
    const formattedData = await getFormattedDataFromRedis(formattedDataKey);

    // Log the response data to the console
    console.log('Extracted Data:', formattedData);

    // Render the results on the index page, pass the formattedDataKey as 'key'
    res.render('index', { fields: Object.keys(formattedData), data: formattedData, model, key: formattedDataKey });
  } catch (error) {
    console.error('Error during scraping:', error);
    res.status(500).send('An error occurred during scraping.');
  }
});

// Endpoint to retrieve and view formatted data from Redis
app.get('/view-data', async (req, res) => {
  const { key } = req.query;

  try {
    const data = await getFormattedDataFromRedis(key);

    if (!data) {
      return res.status(400).send('No data available for the provided key.');
    }

    res.render('index', { fields: Object.keys(data), data, model: 'llama3.1', key }); // Pass model and data to the template
  } catch (error) {
    console.error('Error retrieving data from Redis:', error);
    res.status(500).send('Failed to retrieve data.');
  }
});

// Function to format data into CSV
function formatDataToCSV(data) {
  const fields = Object.keys(data); // Get headers from data keys
  const rows = [];
  const numRows = Math.max(...fields.map(field => data[field].length)); // Determine max number of rows

  for (let i = 0; i < numRows; i++) {
    const row = {};
    fields.forEach(field => {
      row[field] = data[field][i] || ''; // Populate each row with data or empty string if undefined
    });
    rows.push(row);
  }

  return parse(rows, { fields }); // Convert rows to CSV using headers
}

// Endpoint to download extracted data as a CSV file
app.get('/download-csv', async (req, res) => {
  const key = req.query.key;

  try {
    // Fetch the formatted data from Redis
    const data = await getFormattedDataFromRedis(key);

    if (!data) {
      return res.status(400).send('No CSV data available for download.');
    }

    // Format the data as CSV
    const csv = formatDataToCSV(data);
    const filePath = path.join(__dirname, 'results.csv');

    // Save CSV data to file before sending
    fs.writeFileSync(filePath, csv);

    // Send the CSV file for download
    res.download(filePath, 'results.csv', (err) => {
      if (err) {
        console.error('Error downloading the CSV file:', err);
        if (!res.headersSent) {
          res.status(500).send('Failed to download CSV.');
        }
      } else {
        // Optionally delete the file after sending
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    console.error('Error downloading CSV:', error);
    if (!res.headersSent) {
      res.status(500).send('Failed to download CSV.');
    }
  }
});

// Endpoint to download extracted data as a JSON file
app.get('/download-json', async (req, res) => {
  const key = req.query.key; // Key used to retrieve data from Redis

  try {
    // Retrieve the formatted data from Redis
    const data = await getFormattedDataFromRedis(key);

    if (!data) {
      return res.status(400).send('No JSON data available for download.');
    }

    // Convert JSON data to a string format
    const jsonData = JSON.stringify(data, null, 2); // Pretty format the JSON for readability
    const filePath = path.join(__dirname, 'results.json');

    // Save JSON data to a file before sending
    fs.writeFileSync(filePath, jsonData);

    // Send the JSON file for download
    res.download(filePath, 'results.json', (err) => {
      if (err) {
        console.error('Error downloading the JSON file:', err);
        if (!res.headersSent) {
          res.status(500).send('Failed to download JSON.');
        }
      } else {
        // Optionally delete the file after sending
        fs.unlinkSync(filePath);
      }
    });
  } catch (error) {
    console.error('Error downloading JSON:', error);
    if (!res.headersSent) {
      res.status(500).send('Failed to download JSON.');
    }
  }
});

module.exports = app;
