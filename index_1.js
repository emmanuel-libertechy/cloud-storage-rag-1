import express from "express";
import multer from "multer";
import fs from "fs/promises";

import { Storage } from "@google-cloud/storage";
import {
  Document,
  VectorStoreIndex,
  SimpleDirectoryReader,
  LlamaParseReader,
  storageContextFromDefaults,
} from "llamaindex";

const app = express();
app.use(express.json()); // Parse JSON bodies

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

// Endpoint 1: Create storage context and set up query engine
app.post("/create-storage-context", async (req, res) => {
  try {
    // Create storage context
    storageContext = await storageContextFromDefaults({
      persistDir: "mnt/storage/storage", // GCS bucket path
    });

    // Load documents
    // storage fuse must have been used to load to this directory mnt/storage
    const literatureDocuments = await new SimpleDirectoryReader().loadData({
      directoryPath: "mnt/storage/data", // GCS bucket path
      fileExtToReader: {
        pdf: new LlamaParseReader({ resultType: "markdown" }),
      },
    });

    // Create the VectorStoreIndex and query engine
    const literatureIndex = await VectorStoreIndex.fromDocuments(
      literatureDocuments,
      { storageContext }
    );
    queryEngine = literatureIndex.asQueryEngine();

    res.status(200).json({
      message: "Storage context and query engine created successfully.",
    });
  } catch (error) {
    console.error("Error creating storage context:", error);
    res.status(500).json({ error: "Failed to create storage context." });
  }
});

// Endpoint 2: Ask a question
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

    const response = await queryEngine.query({ query });
    res.status(200).json({ response: response.toString() });
  } catch (error) {
    console.error("Error processing query:", error);
    res.status(500).json({ error: "Failed to process query." });
  }
});

// Endpoint 3: Add a new document and update the index
import fs from "fs/promises";

app.post("/add-document", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const filePath = req.file.path; // Path to the uploaded file by multer
    const destination = `data/${req.file.originalname}`; // Path in GCS

    // Upload the file to Google Cloud Storage
    await bucket.upload(filePath, {
      destination,
      gzip: true,
    });

    console.log(`File uploaded to ${bucketName}/${destination}`);

    // Wait for gcsfuse to sync the file to the `mnt/storage/data` directory
    const syncedPath = `mnt/storage/data/${req.file.originalname}`;
    console.log(`Checking if file exists at: ${syncedPath}`);

    // Verify if the file exists at the synced location
    try {
      await fs.access(syncedPath); // Check if the file exists
      console.log(`File found at ${syncedPath}`);
    } catch (err) {
      console.error(
        `File not found at ${syncedPath}. Check if gcsfuse is syncing properly.`
      );
      return res
        .status(500)
        .json({ error: "File not found in synced directory." });
    }

    console.log(`File path to load: ${syncedPath}`);

    // Load the new document from the synced path
    const newDocument = await new SimpleDirectoryReader().loadData({
      filePaths: [syncedPath], // Pass a valid array of file paths
      fileExtToReader: {
        pdf: new LlamaParseReader({ resultType: "markdown" }),
      },
    });

    if (newDocument.length === 0) {
      return res
        .status(400)
        .json({ error: "Failed to load the document. Check the file path." });
    }

    // Initialize the storage context
    storageContext = await storageContextFromDefaults({
      persistDir: "mnt/storage/storage",
    });

    // Initialize or load the existing index
    const literatureIndex = await VectorStoreIndex.init({
      storageContext: storageContext,
    });

    // Add the new document to the existing index
    await literatureIndex.addDocuments(newDocument);

    res
      .status(200)
      .json({ message: "Document added and index updated successfully." });
  } catch (error) {
    console.error("Error adding document to index:", error);
    res.status(500).json({ error: "Failed to add document to index." });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
