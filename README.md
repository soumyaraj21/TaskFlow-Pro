# TaskFlow Pro

## 🌐 Live Demo

https://task-flow-pro-orcin.vercel.app

TaskFlow Pro is a smart project management application built with a React frontend and an Express/Prisma/PostgreSQL backend. It features an automated Directed Acyclic Graph (DAG) scheduling engine that dynamically shifts task dates based on dependencies, as well as AI-powered features for dependency suggestion and natural-language "What-If" simulations powered by Groq.

## Setup Steps

### Prerequisites
- Node.js (v18+)
- PostgreSQL (running locally)
- A Groq API Key

### 1. Environment Variables
In the `server` directory, create a `.env` file (or update the existing one) with:
```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/taskflow?schema=public"
PORT=3001
GROQ_API_KEY="your_groq_api_key_here"
```

### 2. Database Migrations & Seeding
Start your PostgreSQL server, then run the following commands in the `server` directory:
```bash
cd server
npm install
npx prisma db push
node prisma/seed.js
```

### 3. Run the Backend
```bash
cd server
npm start
# (Or use node index.js)
```

### 4. Run the Frontend
In a separate terminal:
```bash
cd client
npm install
npm run dev
```
Then open `http://localhost:5173` in your browser.

## Architecture Overview
The application consists of a decoupled frontend and backend:
- **Frontend (Client)**: A Vite + React application using `@dnd-kit` for drag-and-drop kanban functionality. It communicates with the backend via standard REST APIs. State is managed via React hooks.
- **Backend (Server)**: An Express server handling REST endpoints. Data persistence is managed via Prisma ORM connected to PostgreSQL.
- **DAG Engine**: A core service (`server/services/dagEngine.js`) containing pure functions that calculate the critical path, block/unblock downstream tasks, and propagate date shifts efficiently across multiple levels without compounding delays.
- **AI Service**: Integrates with Groq's OpenAI-compatible Chat Completions API. AI is used for dependency suggestions and natural-language What-If parsing. The deterministic DAG engine remains authoritative for dependency validation and scheduling.

## Data Model
- **Tasks**: Represents individual work items. Attributes include `title`, `description`, `status` (backlog, in_progress, review, done), `duration_days`, and computed start/end dates.
- **Dependencies**: A many-to-many join table between tasks representing the DAG edges (`predecessor_id` -> `successor_id`). Includes `lag_days` and `source` (manual vs. ai_suggested).
- **AI Suggestions**: Stores pending AI dependency recommendations, containing a `confidence` score and `rationale`. These can be accepted or rejected.
- **Audit Log**: Tracks historical state changes (like task status updates) for debugging and potential undo functionality.

## Key Assumptions and Limitations
- **Cycle-Free Constraint**: The graph must be an acyclic directed graph. Cyclic dependencies are explicitly rejected by the backend.
- **Single Workspace**: The current implementation assumes a single unified project board without multi-tenant workspaces.
- **Stateless AI Processing**: The AI relies on a full dump of the current task list within its context window. For very large projects, this might exceed context limits.
- **Date Handling**: Scheduled shifts apply simplistic additions to days and do not currently respect weekends or custom company holidays.

## Known Failure Cases
- **Concurrent Edits**: Since there are no optimistic locks or real-time web sockets (like Socket.io), if two users drag-and-drop tasks or add dependencies simultaneously, they may overwrite each other's changes or create inconsistent local states until the page is refreshed.
- **Large Graph Constraints**: For heavily interconnected graphs with thousands of nodes, the recursive DAG calculations inside Node.js might cause event-loop blocking, slowing down API responses.
- **API Rate Limiting**: Extensive use of AI features may result in 503 "High Demand" or 429 "Too Many Requests" errors from the Groq API. The system currently mitigates this with basic retries, but sustained usage may temporarily stall AI features.
