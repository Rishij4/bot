# 🎓 AI Student Assistant

A simple, friendly chatbot created for beginner students. It answers your learning questions in easy, step-by-step English using an AI model that runs 100% locally on your computer with **Ollama** and **Meta Llama 3.2**.

---

## 🌟 Features

1. **Simple, Cheerful Interface**: Clean chat bubbles, easy-to-read text, and quick-prompt buttons for learning.
2. **Easy English Explanations**: Specially instructed to break down difficult concepts into plain, beginner-friendly explanations with real-world examples.
3. **100% Private & Free**: Runs completely on your computer via Ollama. No credit cards, no API keys, and no internet required once downloaded!
4. **Friendly Error Guidance**: If Ollama is turned off, the app immediately informs you and guides you on how to start it.
5. **Zero Complex Dependencies**: Built with pure Node.js standard libraries—no complicated package installations (`npm install`) needed!

---

## 🚀 How to Run the Project

### Step 1: Make sure Ollama is running
Ollama must be open on your computer. You can check by opening your terminal and typing:
```bash
ollama list
```
You should see `llama3.2:latest` listed.

### Step 2: Start the Student Assistant Server
Open your terminal in this project folder and run:
```bash
node server.js
```

You will see:
```text
🎓 AI Student Assistant Server is running!
👉 Open your browser at: http://localhost:3000
🤖 Connected to local model: llama3.2:latest
```

### Step 3: Open in your Browser
Open your favorite web browser (Chrome, Edge, Firefox, Brave) and go to:
[http://localhost:3000](http://localhost:3000)

---

## 💡 How it Works (Under the Hood)

Here is the simple 3-step path every question takes:

1. **You type a question** on the web page (e.g., *"Why do leaves change color in autumn?"*) and click **Send**.
2. **The Node.js server (`server.js`)** receives your question and pairs it with a special teaching guide:
   > *"Explain concepts clearly in simple, easy-to-understand English for beginner students with real-life examples."*
3. **Ollama & Llama 3.2** process your question locally on your computer hardware and send back an easy-to-understand explanation right into your chat window!
