import express from "express";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import os from "os";


import { Storage } from "@google-cloud/storage";
import {
  Document,
  VectorStoreIndex,
  SimpleDirectoryReader,
  LlamaParseReader,
  storageContextFromDefaults,
  ContextChatEngine,
  OpenAIAgent,
  QueryEngineTool,
  RouterQueryEngine,
} from "llamaindex";

import { locationFunctionTool } from "./location_data.js";

const app = express();
app.use(express.json()); // Parse JSON bodies

import admin from 'firebase-admin';
let serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
const firestore = admin.firestore();

// Google Cloud Storage setup
const bucketName = "ccm-literature";
const storage = new Storage();
const bucket = storage.bucket(bucketName);

// Configure multer to store files temporarily in 'mnt/storage/data'
const upload = multer({
    dest: "mnt/storage/data", // Temporary directory for uploaded files
  });


// Helper to upload files to GCS
// async function uploadToBucket(filePath, destination) {
//   await bucket.upload(filePath, {
//     destination,
//     gzip: true,
//   });
//   console.log(`Uploaded ${filePath} to ${bucketName}/${destination}`);
// }

// Global storage context and query engine variables
let storageContext = null;
let queryEngine = null;

// Cache for VectorStoreIndex and QueryEngine
let cachedIndex = null;
let cachedQueryEngine = null;

// Lazy-loading function for VectorStoreIndex
async function loadVectorIndex() {
    if (!cachedIndex || !cachedQueryEngine) {
      console.log("Loading vector index...");
      const storageContext = await storageContextFromDefaults({
        persistDir: "mnt/storage/storage", // Path for vector storage
      });
  
      cachedIndex = await VectorStoreIndex.init({ storageContext });
      cachedQueryEngine = await cachedIndex.asQueryEngine();
    }
  
    return cachedQueryEngine;
  }

// let messageHistory = [
//     {
//         role: "user",
//         content: "What is the main consequence of offence?"
//     },
//     {
//         role: "assistant",
//         content: "The main consequence of offense is being held captive by the devil to do his will. Offense can lead to deception, bitterness, anger, resentment, betrayal, hatred, and ultimately death if not dealt with. It can also lead to a distorted view of oneself and others, hindering true repentance and forgiveness."
//     }
// ]

// Endpoint 1: Create storage context and set up query engine
app.post("/create-storage-context", async (req, res) => {
  try {
    // Create storage context
    storageContext = await storageContextFromDefaults({
      persistDir: "mnt/storage/storage", // GCS bucket path
    });
    console.log('storage context created')

    // Load documents
    // storage fuse must have been used to load to this directory mnt/storage
    console.log('loading documents')
    const literatureDocuments = await new SimpleDirectoryReader().loadData({
      directoryPath: "mnt/storage/data", // GCS bucket path
      fileExtToReader: {
        pdf: new LlamaParseReader({ resultType: "markdown" }),
      },
    });
    console.log('documents loaded')


    // Create the VectorStoreIndex and query engine
    console.log('creating index')
    cachedIndex = await VectorStoreIndex.fromDocuments(
      literatureDocuments,
      { storageContext }
    );
    console.log('index created')
    cachedQueryEngine = cachedIndex.asQueryEngine();

    res.status(200).json({
      message: "Storage context and query engine created successfully.",
    });
  } catch (error) {
    console.error("Error creating storage context:", error);
    res.status(500).json({ error: "Failed to create storage context." });
  }
});

// Endpoint 2: Ask a question
// app.post("/ask-question", async (req, res) => {
//     try {
//       const { query } = req.body;
  
//       if (!query) {
//         return res
//           .status(400)
//           .json({ error: "The 'query' field is required in the request body." });
//       }
  
//       // Lazy-load the query engine tool when needed
//       const queryEngineTool = new QueryEngineTool({
//         async queryEngine() {
//           return loadVectorIndex();
//         },
//         metadata: {
//           name: "faith_and_embedding_engine",
//           description:
//             "A tool for answering questions on Christian faith and document embeddings.",
//         },
//       });
  
  
//       // Agent with tools
//       const agent = new OpenAIAgent({
//         tools: [queryEngineTool, locationFunctionTool],
//         verbose: true,
//         model: "gpt-4o",
//         waitForAsync: true,
//       });
  
//       // Ask the question
//       const response = await agent.chat({ message: query });
  
//       res.status(200).json({ response: response.toString() });
//     } catch (error) {
//       console.error("Error processing query:", error);
//       res.status(500).json({ error: "Failed to process query." });
//     }
//   });
app.post("/ask-question", async (req, res) => {
  try {
    const { query } = req.body;
   
    if (!query) {
      return res
        .status(400)
        .json({ error: "The 'query' field is required in the request body." });
    }

    storageContext = await storageContextFromDefaults({
        persistDir: "mnt/storage/storage", // GCS bucket path
      });
    
        //### Initialize the index
    let index = await VectorStoreIndex.init({
        storageContext: storageContext
    });
    
    queryEngine = await index.asQueryEngine()

    if (!queryEngine) {
      return res
        .status(400)
        .json({ error: "Query engine is not initialized. Please set up the storage context first." });
    }

    const routerQueryEngine = await RouterQueryEngine.fromDefaults({
        queryEngineTools: [
          {
            queryEngine: queryEngine,
            description: "Useful for questions about Christian faith as well as vector embeddings and Generative AI",
          },
        //   {
        //     queryEngine: queryEngine2,
        //     description: "Useful for questions about vector embeddings",
        //   },
        ],
      });

    // Create Query Engine Tool
    const queryEngineTool = new QueryEngineTool({
        queryEngine: routerQueryEngine,
        metadata: {
        name: "faith_and_embedding_engine",
        description: "A tool that can answer questions about Christian faith and document embeddings.",
        },
    });

    // Register tools with the agent
    const agent = new OpenAIAgent({
        tools: [queryEngineTool,  locationFunctionTool],
        verbose: true,
        model: "gpt-4o",
        waitForAsync: true,
      });

    const response = await agent.chat({ message:query });
    res.status(200).json({ response: response.toString() });
  } catch (error) {
    console.error("Error processing query:", error);
    res.status(500).json({ error: "Failed to process query." });
  }
});

// Endpoint 3: Add a new document and update the index


app.post("/add-document", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const filePath = req.file.path; // Path to the uploaded file by multer
    const destination = `data/temp/${req.file.originalname}`; // Path in GCS
    const fileName = req.file.originalname;


    // Upload the file to Google Cloud Storage
    await bucket.upload(filePath, {
      destination,
      gzip: true,
    });

    console.log(`File uploaded to ${bucketName}/${destination}`);

    // Create a temporary directory for processing files
    const tempDir = path.join(os.tmpdir(), "temp-files");
    await fs.mkdir(tempDir, { recursive: true });

    // Copy the uploaded file to the local temporary directory
    const localTempFilePath = path.join(tempDir, fileName);
    await fs.copyFile(filePath, localTempFilePath);
    console.log(`File copied to temporary directory: ${localTempFilePath}`);


    // Create a temporary directory and copy the file there
    // const tempDir = "mnt/storage/data/temp";

    // Load the new document from the temporary directory
    console.log(`Loading document from ${tempDir}`);
    const newDocument = await new SimpleDirectoryReader().loadData({
      directoryPath: tempDir, // Provide the directory containing the file
      fileExtToReader: {
        pdf: new LlamaParseReader({ resultType: "markdown" }),
      },
    });
    console.log(`Loaded document from ${tempDir}`);


    if (newDocument.length === 0) {
      return res
        .status(400)
        .json({ error: "Failed to load the document. Check the file path." });
    }

    // Initialize the storage context
    storageContext = await storageContextFromDefaults({
      persistDir: "mnt/storage/storage",
    });

    // // Initialize or load the existing index
    // const literatureIndex = await VectorStoreIndex.init({
    //   storageContext: storageContext,
    // });

    // // Add the new document to the existing index
    // await literatureIndex.insert(newDocument);
    await VectorStoreIndex.fromDocuments(newDocument,{
        storageContext
      })

    res
      .status(200)
      .json({ message: "Document added and index updated successfully." });
  } catch (error) {
    console.error("Error adding document to index:", error);
    res.status(500).json({ error: "Failed to add document to index." });
  }
});

// Route to handle chat requests
app.post("/chat", async (req, res) => {
    try {
      const { message, userId } = req.body;
  
      if (!message || !userId) {
        return res.status(400).json({ error: "Message and userId are required." });
      }
  
      // Lazy-load the retriever
      const retriever = await loadVectorRetriever();
  
      // Initialize the ContextChatEngine
      const chatEngine = new ContextChatEngine({ retriever });
  
      // Retrieve existing chat history for the user from Firestore
      const userDocRef = firestore.collection("chats").doc(userId);
      const userDoc = await userDocRef.get();
      let messageHistory = [];
  
      if (userDoc.exists) {
        messageHistory = userDoc.data().messageHistory || [];
      }
  
      // Add the user's message to the history
      messageHistory.push({ role: "user", content: message });
  
      // Process the chat message using the chat engine
      const response = await chatEngine.chat({
        message,
        chatHistory: messageHistory,
      });
  
      // Add the assistant's response to the history
      messageHistory.push({ role: "assistant", content: response.message.content });
  
      // Persist updated chat history back to Firestore
      await userDocRef.set({ messageHistory });
  
      // Send the assistant's response back to the user
      res.status(200).json({ response: response.message.content });
    } catch (error) {
      console.error("Error processing chat message:", error);
      res.status(500).json({ error: "An error occurred while processing your request." });
    }
  });
// app.post("/chat", async (req, res) => {
//     try {
//         const { message, userId } = req.body; // Expecting the message content and user ID from the user
//         if (!message || !userId) {
//             return res.status(400).json({ error: "Message and userId are required." });
//         }

//         storageContext = await storageContextFromDefaults({
//             persistDir: "mnt/storage/storage", // GCS bucket path
//         });

//         // Initialize the index
//         let index = await VectorStoreIndex.init({
//             storageContext: storageContext,
//         });

//         const retriever = index.asRetriever();
//         const chatEngine = new ContextChatEngine({
//             retriever,
//         });

//         // Retrieve existing chat history for the user
//         const userDocRef = firestore.collection("chats").doc(userId);
//         const userDoc = await userDocRef.get();
//         let messageHistory = [];

//         if (userDoc.exists) {
//             // Use existing history
//             messageHistory = userDoc.data().messageHistory || [];
//         }

//         // Add user message to the history
//         messageHistory.push({ role: "user", content: message });

//         // Process the chat message using the chat engine
//         const response = await chatEngine.chat({
//             message,
//             chatHistory: messageHistory,
//         });

//         // Add assistant response to the history
//         messageHistory.push({ role: "assistant", content: response.message.content });

//         // Persist updated chat history back to Firestore
//         await userDocRef.set({ messageHistory });

//         // Send the assistant's response back to the user
//         res.json({ response:response.message.content });
//     } catch (error) {
//         console.error("Error processing chat message:", error);
//         res.status(500).json({ error: "An error occurred while processing your request." });
//     }
// });


// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
