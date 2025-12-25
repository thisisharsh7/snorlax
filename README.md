# Code Q&A Platform

Ask questions about any GitHub repository using AI.

## Features

- Index any public GitHub repository
- Ask questions in natural language
- Get AI-powered answers with code references
- Powered by CocoIndex for intelligent code processing

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- Docker and Docker Compose

### Setup

1. **Navigate to the example directory**
   ```bash
   cd examples/code-qa
   ```

2. **Add your API keys to `.env`**
   ```bash
   # Edit .env and add:
   OPENAI_API_KEY=your_key_here
   ANTHROPIC_API_KEY=your_key_here
   ```

3. **Start PostgreSQL**
   ```bash
   docker-compose up -d
   ```

4. **Setup Backend**
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   python main.py
   ```

5. **Setup Frontend** (in new terminal)
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

6. **Open Browser**
   ```
   http://localhost:3000
   ```

## Usage

1. Enter a GitHub repository URL (e.g., `https://github.com/pallets/flask`)
2. Wait for indexing (1-3 minutes)
3. Ask questions about the code
4. Get answers with source code references

## Architecture

- **Frontend**: Next.js + TypeScript + Tailwind CSS
- **Backend**: FastAPI + CocoIndex
- **Database**: PostgreSQL + pgvector
- **AI**: OpenAI (embeddings) + Anthropic Claude (LLM)

## Tech Stack

- **CocoIndex**: Intelligent code indexing with incremental updates
- **pgvector**: Vector similarity search
- **Claude Sonnet 4.5**: Natural language understanding
- **OpenAI Embeddings**: Semantic code search

## License

MIT
