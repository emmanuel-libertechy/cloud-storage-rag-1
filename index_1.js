import express from "express";
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

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
