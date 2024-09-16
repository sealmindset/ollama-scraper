from flask import Flask, request, jsonify
import subprocess
import socket
import time
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS to allow cross-origin requests

def find_available_port(start=11400, end=11499):
    """Find the first available port in the specified range."""
    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    raise RuntimeError(f"No available ports in the range {start}-{end}")

# Find an available port
port = find_available_port()

def is_model_installed(model_name):
    """Check if the specified model is installed in Ollama."""
    try:
        result = subprocess.run(['ollama', 'list'], capture_output=True, text=True)
        lines = result.stdout.strip().split('\n')
        # Skip the header line
        model_lines = lines[1:] if len(lines) > 1 else []
        installed_models = []
        for line in model_lines:
            columns = line.split('\t')
            if columns:
                model = columns[0].strip()
                installed_models.append(model)
        print(f"Installed models: {installed_models}")
        # Check for exact match
        return model_name in installed_models
    except Exception as e:
        print(f"Error checking if model {model_name} is installed:", str(e))
        return False

def download_model(model_name, retries=3):
    """Attempt to download the specified model with retries."""
    try:
        print(f"Attempting to download model: {model_name}...")
        for attempt in range(retries):
            result = subprocess.run(['ollama', 'pull', model_name], capture_output=True, text=True)
            print(f"Download attempt {attempt + 1}: stdout: {result.stdout}, stderr: {result.stderr}")
            if result.returncode == 0:
                print(f"Model {model_name} downloaded successfully.")
                return True
            else:
                print(f"Error downloading model {model_name} on attempt {attempt + 1}: {result.stderr}")
                # Check specific error messages and handle them if needed
                if "Network error" in result.stderr or "Timeout" in result.stderr:
                    print("Retrying download due to network issue...")
                    time.sleep(5)  # Wait before retrying
        print(f"Failed to download model {model_name} after {retries} attempts.")
        return False
    except Exception as e:
        print(f"Error during model download {model_name}:", str(e))
        return False

@app.route('/models', methods=['GET'])
def get_models():
    """Fetch the list of available models from Ollama."""
    try:
        result = subprocess.run(['ollama', 'list'], capture_output=True, text=True)
        lines = result.stdout.strip().split('\n')
        # Skip the header line
        model_lines = lines[1:] if len(lines) > 1 else []
        models = []
        for line in model_lines:
            columns = line.split('\t')
            if columns:
                model = columns[0].strip()
                models.append(model)
        return jsonify({'models': models})
    except Exception as e:
        print("Error fetching models:", str(e))
        return jsonify({'error': 'Failed to fetch models', 'details': str(e)})

@app.route('/ollama', methods=['POST'])
def post_ollama():
    """Handle POST requests to interact with the selected model."""
    html_content = request.json.get('html', '')
    user_message = request.json.get('message', '')
    selected_model = request.json.get('model', 'openchat')  # Use 'openchat' as default if not specified

    print(f"Selected model: {selected_model}")

    # Check if HTML content is provided
    if not html_content:
        return jsonify({'response': 'No HTML content provided to extract fields from.'})

    # Check if the model is installed, and download if not
    if not is_model_installed(selected_model):
        if not download_model(selected_model):
            return jsonify({'error': f'Failed to download the model: {selected_model}'})

    # Prompt for structured data extraction with the selected model
    prompt = (
        f"Extract the following fields from the provided HTML content: {user_message}. "
        "Respond strictly with a valid JSON object containing the extracted fields and their values. "
        "Do not include explanations, tables, or any other text. Only return the JSON object in this format: "
        "{\"Field1\": [\"Value1\", \"Value2\"], \"Field2\": [\"Value1\", \"Value2\"]}."
    )

    # Combine the refined prompt with the HTML content
    full_input = f"{prompt}\n{html_content}"

    try:
        # Use subprocess without shell=True
        command = ['ollama', 'run', selected_model]
        output = subprocess.run(command, input=full_input, capture_output=True, text=True)
        response = output.stdout if output.returncode == 0 else output.stderr
        print("Executed command:", ' '.join(command))
        print(f"{selected_model} response:", response)
        return jsonify({'response': response})
    except Exception as e:
        print("Error executing command:", str(e))
        return jsonify({'error': 'Failed to execute the model command', 'details': str(e)})

@app.route('/ollama', methods=['PUT', 'DELETE'])
def other_verbs():
    """Handle other HTTP verbs if needed."""
    return jsonify({'message': 'This endpoint can be extended for other HTTP verbs'})

if __name__ == '__main__':
    print(f"Starting server on port {port}")
    app.run(host='0.0.0.0', port=port)
