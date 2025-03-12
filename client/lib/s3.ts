import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import axios from "axios";

// Define types for file objects
type FileWithBuffer = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  type?: string;
};

type FileInput = Buffer | FileWithBuffer | Blob;

// Check for required environment variables
const requiredEnvVars = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
  "AWS_S3_BUCKET_NAME",
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
}

// Configure AWS S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

/**
 * Checks if the Python service is available
 * @returns - True if the service is available, false otherwise
 */
async function isPythonServiceAvailable(): Promise<boolean> {
  try {
    await axios.get("http://localhost:8000/health", { timeout: 2000 });
    return true;
  } catch (error) {
    console.warn("Python service is not available:", error);
    return false;
  }
}

/**
 * Sends file URL to Python processing service
 * @param fileUrl - The URL of the file in S3
 * @returns - Response from the Python service
 */
export async function sendUrlToPythonService(fileUrl: string): Promise<any> {
  if (!(await isPythonServiceAvailable())) {
    console.warn("Skipping Python service call - service not available");
    return null;
  }

  try {
    console.log("Sending URL to Python service:", fileUrl);
    // Add trailing slash to match FastAPI route definition and increase timeout
    const response = await axios.post(
      "http://localhost:8000/parse-resume/",
      { url: fileUrl },
      { timeout: 60000 } // 60-second timeout for processing large files
    );
    console.log("Python service response received");
    return response.data;
  } catch (error: any) {
    console.error("Error sending URL to Python service:", error);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    } else if (error.code === "ECONNRESET") {
      console.error(
        "Connection was reset. The server might be taking too long to respond."
      );
    }
    // Return null instead of failing to allow the application to continue
    return null;
  }
}

/**
 * Uploads a file to S3 and returns the URL
 * @param file - The file to upload (Buffer, Blob, or object with arrayBuffer method)
 * @param fileName - The name to use for the file
 * @param sendToPython - Whether to send the URL to Python service (default: false)
 * @returns - URL of the uploaded file and Python service response if requested
 */
export async function uploadFile(
  file: FileInput,
  fileName: string,
  sendToPython = false
): Promise<{ fileUrl: string; pythonResponse?: any }> {
  if (!process.env.AWS_S3_BUCKET_NAME) {
    throw new Error(
      "AWS_S3_BUCKET_NAME is not defined in environment variables"
    );
  }

  try {
    // Convert file to buffer if needed
    let fileBuffer: ArrayBuffer | Buffer;
    let contentType: string = "application/octet-stream";

    if (file instanceof Buffer) {
      fileBuffer = file;
    } else if (
      "arrayBuffer" in file &&
      typeof file.arrayBuffer === "function"
    ) {
      fileBuffer = await file.arrayBuffer();
      contentType = (file as FileWithBuffer).type || contentType;
    } else if (file instanceof Blob) {
      fileBuffer = await file.arrayBuffer();
      contentType = file.type || contentType;
    } else {
      throw new Error("Unsupported file type");
    }

    // Create a unique key for the file
    const fileKey = `applications/${Date.now()}-${fileName}`;

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: fileKey,
      Body:
        file instanceof Buffer
          ? file
          : Buffer.from(new Uint8Array(fileBuffer as ArrayBuffer)),
      ContentType: contentType,
      ACL: "public-read",
    });

    await s3Client.send(command);

    // Construct the URL
    const fileUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

    // Send URL to Python service if requested
    let pythonResponse = null;
    if (sendToPython) {
      try {
        pythonResponse = await sendUrlToPythonService(fileUrl);
      } catch (error) {
        console.error("Python service error:", error);
        // Continue execution even if Python service fails
      }
    }

    return { fileUrl, pythonResponse };
  } catch (error) {
    console.error("Error uploading to S3:", error);
    const errorMessage =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Unknown error";
    throw new Error(`Failed to upload file: ${errorMessage}`);
  }
}

export default s3Client;
