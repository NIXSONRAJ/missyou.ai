import os
import sys
import json
import sqlite3
import requests
import mimetypes
import threading
from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename

# --- RAG / BRAIN IMPORTS ---
from PyPDF2 import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS

# --- PYINSTALLER FIX: Redirect stdout to prevent 'isatty' crashes ---
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')

# --- WINDOWS CSS/JS BINDING FIX ---
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/javascript', '.js')

# --- PATH CONFIGURATION ---
if getattr(sys, 'frozen', False):
    # If running as .exe, store data in LocalAppData so it persists
    base_path = sys._MEIPASS
    data_path = os.path.join(os.environ['LOCALAPPDATA'], 'missyou-ai')
else:
    base_path = os.path.dirname(os.path.abspath(__file__))
    data_path = base_path

os.makedirs(data_path, exist_ok=True)
os.makedirs(os.path.join(data_path, 'uploads'), exist_ok=True)

app = Flask(__name__, 
            template_folder=base_path, 
            static_folder=base_path, 
            static_url_path='')

CONFIG_FILE = os.path.join(data_path, 'missyou_config.json')
DB_FILE = os.path.join(data_path, 'missyou.db')
UPLOAD_FOLDER = os.path.join(data_path, 'uploads')

# --- INITIALIZE EMBEDDING ENGINE ---
print("Initializing missyou.ai logic core...")
# This stays local; no data is sent to the cloud for embedding
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
session_vector_stores = {}

SYSTEM_INSTRUCTION = """
You are missyou.ai, a world-class, highly empathetic Computer Science mentor. 
If context from an uploaded document is provided, use it heavily to answer accurately.
Rules:
1. Be encouraging, clear, and grounded. 
2. Structure answers with markdown and code blocks.
3. Maintain a minimalist, premium tone.
"""

# --- DATABASE LOGIC ---
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT)''')
    c.execute('''CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER, role TEXT, content TEXT)''')
    conn.commit()
    conn.close()

init_db()

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def get_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    return None

# --- RAG: DOCUMENT PROCESSING ---
def process_file_to_vectorstore(filepath, session_id):
    text = ""
    if filepath.endswith('.pdf'):
        reader = PdfReader(filepath)
        for page in reader.pages:
            text += page.extract_text() or ""
    else:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            text = f.read()

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=80)
    chunks = splitter.split_text(text)
    vectorstore = FAISS.from_texts(chunks, embeddings)
    session_vector_stores[session_id] = vectorstore

# --- ROUTES ---
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/check_config', methods=['GET'])
def check_config():
    return jsonify({"has_config": bool(get_config())})

@app.route('/api/save_config', methods=['POST'])
def save_config_route():
    data = request.json
    base_url = data.get('base_url', '').strip()
    model = data.get('model', '').strip()
    api_key = data.get('api_key', '').strip()
    
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1}
    
    try:
        url = f"{base_url.rstrip('/')}/chat/completions"
        r = requests.post(url, headers=headers, json=payload, timeout=10)
        if r.status_code == 200:
            with open(CONFIG_FILE, 'w') as f:
                json.dump({"base_url": base_url, "model": model, "api_key": api_key}, f)
            return jsonify({"success": True})
        return jsonify({"error": "API Rejected the request."}), 400
    except Exception as e:
        return jsonify({"error": f"Connection failed: {str(e)}"}), 400

@app.route('/api/new_session', methods=['POST'])
def new_session():
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('INSERT INTO sessions (title) VALUES (?)', ("New Conversation",))
    session_id = c.lastrowid
    c.execute('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', (session_id, 'system', SYSTEM_INSTRUCTION))
    conn.commit()
    conn.close()
    return jsonify({"session_id": session_id})

@app.route('/api/upload', methods=['POST'])
def upload_file():
    file = request.files.get('file')
    session_id = request.form.get('session_id')
    if file and session_id:
        filename = secure_filename(file.filename)
        path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(path)
        try:
            process_file_to_vectorstore(path, int(session_id))
            return jsonify({'message': f'📄 **{filename}** assimilated. Context brain updated.'})
        except Exception as e:
            return jsonify({'error': str(e)}), 500
    return jsonify({'error': 'Invalid file upload.'}), 400

@app.route('/api/chat', methods=['POST'])
def chat_api():
    config = get_config()
    data = request.json
    user_msg = data.get('message')
    session_id = data.get('session_id')

    conn = get_db_connection()
    c = conn.cursor()
    c.execute('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', (session_id, 'user', user_msg))
    conn.commit()

    # RAG Search
    context = ""
    if int(session_id) in session_vector_stores:
        docs = session_vector_stores[int(session_id)].similarity_search(user_msg, k=3)
        context = "\n\n[USER DOCUMENT CONTEXT]:\n" + "\n".join([d.page_content for d in docs])

    c.execute('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC', (session_id,))
    history = [{"role": r['role'], "content": r['content']} for r in c.fetchall()]
    
    if context:
        history[-1]['content'] += context

    try:
        url = f"{config['base_url'].rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"}
        response = requests.post(url, headers=headers, json={"model": config['model'], "messages": history})
        reply = response.json()['choices'][0]['message']['content']
        
        c.execute('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)', (session_id, 'assistant', reply))
        conn.commit()
        conn.close()
        return jsonify({'reply': reply})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/regenerate', methods=['POST'])
def regenerate_api():
    config = get_config()
    session_id = request.json.get('session_id')
    conn = get_db_connection()
    c = conn.cursor()
    
    c.execute('SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY id ASC', (session_id,))
    rows = c.fetchall()
    if len(rows) < 2: return jsonify({'error': 'No context to regenerate.'}), 400
        
    last_assistant_id = rows[-1]['id']
    history = [{"role": r['role'], "content": r['content']} for r in rows[:-1]] 
    
    try:
        url = f"{config['base_url'].rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"}
        response = requests.post(url, headers=headers, json={"model": config['model'], "messages": history})
        new_reply = response.json()['choices'][0]['message']['content']
        
        c.execute('UPDATE messages SET content = ? WHERE id = ?', (new_reply, last_assistant_id))
        conn.commit()
        conn.close()
        return jsonify({'reply': new_reply})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)