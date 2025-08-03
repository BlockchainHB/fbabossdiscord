# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build and Development
- `npm build` - Compile TypeScript to JavaScript in the dist/ directory
- `npm run dev` - Start development server with hot reload using nodemon and ts-node
- `npm start` - Run the production build from dist/index.js
- `npm run deploy` - Deploy slash commands to Discord (run after adding new commands)

### Environment Setup
- Create `.env` file with required environment variables (see config files for requirements)
- Run `npm install` to install dependencies after cloning

## Architecture Overview

### Core Components

**Main Application Flow**
- `src/index.ts` - Entry point that initializes the Bot class and loads commands dynamically
- `src/deploy-commands.ts` - Separate script to register Discord slash commands with Discord API

**Discord Integration**
- `src/services/discord-client.ts` - Main Discord client service that handles all Discord events and interactions
- `src/commands/` - Discord slash command implementations (auto-loaded by filename)
- `src/types/command.ts` - TypeScript interfaces for Discord command structure

**AI/QA Pipeline**
- `src/services/qa-pipeline.ts` - Main orchestration service that processes user questions through the AI pipeline
- `src/services/openai.ts` - OpenAI API integration for embeddings, chat completions, and answer validation
- `src/services/pinecone.ts` - Vector database service for similarity search of course content
- `src/services/namespace-router.ts` - Routes questions to relevant content namespaces based on topic classification

**Data Layer**
- `src/services/discord-database.ts` - Database service for Discord-specific data (guilds, users, interactions)
- `src/config/database.ts` - Supabase client configuration
- `src/services/queue.ts` & `src/services/simple-queue.ts` - Job queue management for processing user questions

### Key Architectural Patterns

**Command System**
- Commands are dynamically loaded from `src/commands/` directory
- Each command exports a default object with `data` (SlashCommandBuilder) and `execute` function
- Commands are automatically registered with Discord via the deploy script

**AI Processing Pipeline**
1. Question improvement via OpenAI
2. Namespace routing to relevant content areas
3. Vector embedding generation
4. Similarity search in Pinecone vector database
5. Context preparation from search results
6. Answer generation with conversation memory
7. Answer quality validation
8. Usage logging and conversation storage

**Database Architecture**
- Uses Supabase with dual data storage:
  - Discord-specific tables for guild/user/interaction data
  - Application tables for conversations, messages, and usage logs
- See `documentations/supabase-database-structure.md` for complete schema

**Vector Search System**
- Uses Pinecone with OpenAI text-embedding-ada-002 (1536 dimensions)
- Content is organized in namespaces for efficient routing
- See `documentations/fba-course-openai-index-structure.md` for detailed structure

### Environment Configuration

**Required Environment Variables**
- `DISCORD_TOKEN` - Bot token from Discord Developer Portal
- `DISCORD_CLIENT_ID` - Application ID from Discord Developer Portal
- `DISCORD_GUILD_ID` - Optional guild ID for faster command deployment during development
- `PRODUCTION_CHANNEL_ID` - Target channel ID for production (default: 1396625770088104070)
- `MEMORY_MESSAGE_LIMIT` - Number of messages to retain in conversation memory (default: 10)
- `OPENAI_API_KEY` - OpenAI API key for embeddings and chat completions
- `PINECONE_API_KEY` - Pinecone API key
- `PINECONE_INDEX_NAME` - Name of the Pinecone index (default: fba-course-openai)
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `REDIS_URL` - Optional Redis URL for Railway deployment

### Path Aliases
TypeScript path aliases are configured in tsconfig.json:
- `@/*` maps to `src/*`
- `@/commands/*` maps to `src/commands/*`
- `@/services/*` maps to `src/services/*`
- `@/types/*` maps to `src/types/*`
- `@/utils/*` maps to `src/utils/*`
- `@/config/*` maps to `src/config/*`

### Logging
- Uses Winston logger configured in `src/utils/logger.ts`
- Logs to both console and files (`logs/combined.log`, `logs/error.log`)
- All service operations and errors are logged with appropriate levels

### Production Features

**Thread Support**
- Full support for Discord private and public threads
- Thread-specific conversation memory isolation
- Channel permission checks for thread parents

**Button Interactions**
- Follow-up questions via modal dialogs
- Detailed clarification requests
- Enhanced source viewing with usage guidance
- Full interaction error handling

**Enhanced Memory System**
- Configurable message limit (default: 10 messages = 5 exchanges)
- Thread-specific memory isolation
- Intelligent context summarization with timestamps
- Cost-optimized conversation context

**Channel Restrictions**
- Production channel whitelist (Channel ID: 1396625770088104070)
- Thread support for whitelisted parent channels
- Automatic permission validation

**Production Polish**
- Retry logic with exponential backoff
- Comprehensive error handling and recovery
- Health monitoring with `/health` command
- Enhanced user feedback and progress indicators

### Error Handling
- Graceful shutdown handlers for SIGTERM/SIGINT
- Retry logic for external service failures
- Comprehensive error logging throughout the application
- Discord interaction error handling with user-friendly error messages
- Database connection resilience with proper error recovery
- Circuit breaker patterns for service degradation