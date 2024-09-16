# ollama-scraper
## Description
A web scrapting tool using a local instance of AI to identify and format the extracted fields to be displayed as CSV. 

The implementation includes:

- Web scraping using axios and cheerio to fetch and parse the webpage.
- Ollama integration to process the extracted data and reformat it according to user-defined fields.
- Redis to store and retrieve the scraped and processed data.

## Preq
- Ollama for Mac
- Node.js
- Python 3.12
- Redis (local)

### Node.js dependencies
```
npm install puppeteer express body-parser axios ejs cheerio redis json2csv rxjs flask_cors
```

### Python dependencies
```
pip install -r requirements.txt
```

## MacOS

### 1. Start Ollama as an API Endpoint
```
python3 ollama_api.py
```

### 2. Start the app
```
node server.js
```

## To Do
- Try out different models
- Redis to cache the data instead of using flat files
  
