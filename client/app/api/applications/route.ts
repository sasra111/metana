import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Application, { IApplication } from "@/lib/models/Application";
import { uploadFile } from "@/lib/s3";
import { sendWebhookNotification } from "@/lib/webhook";

interface QueryParams {
  [key: string]: any;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();

    // Extract form data
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const phone = formData.get("phone") as string;
    const cvFile = formData.get("cv") as File | null;

    if (!name || !email || !phone || !cvFile) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Log information for debugging
    console.log("Received form submission:", {
      name,
      email,
      phone,
      cv: {
        name: cvFile.name,
        type: cvFile.type,
        size: cvFile.size,
      },
    });

    try {
      const fileBuffer = await cvFile.arrayBuffer();
      const fileBlob = new Blob([fileBuffer], { type: cvFile.type });
      const fileName = cvFile.name;

      // Set the third parameter to true to send the URL to Python
      let fileUrl, pythonResponse;
      try {
        const result = await uploadFile(fileBlob, fileName, true);
        fileUrl = result.fileUrl;
        pythonResponse = result.pythonResponse;

        console.log("File uploaded successfully to S3:", fileUrl);
        if (pythonResponse) {
          console.log("Python response received");
        } else {
          console.log("No Python response received");
        }
      } catch (uploadError) {
        if (uploadError.message.includes("Python service")) {
          console.warn("Python service error, proceeding without analysis");
          const result = await uploadFile(fileBlob, fileName, false);
          fileUrl = result.fileUrl;
        } else {
          throw uploadError;
        }
      }

      // Connect to MongoDB and save application data
      await dbConnect();

      // Process parsed resume data if available
      let parsedResume = null;
      let webhookResult = null;

      if (pythonResponse && pythonResponse.parsed_data) {
        try {
          // Try to parse the data if it's a string (JSON)
          const parsedData =
            typeof pythonResponse.parsed_data === "string"
              ? JSON.parse(pythonResponse.parsed_data)
              : pythonResponse.parsed_data;

          parsedResume = {
            fullName: parsedData.fullName,
            email: parsedData.email || email, // Use form email as fallback
            github: parsedData.github,
            linkedin: parsedData.linkedin,
            employment: parsedData.employment,
            technicalSkills: parsedData.technicalSkills,
            softSkills: parsedData.softSkills,
            education: parsedData.education,
            rawData: pythonResponse.parsed_data, // Store original response
          };

          // Send webhook notification with the parsed data
          const webhookData = {
            ...parsedData,
            cvUrl: fileUrl, // Include the S3 URL
          };

          webhookResult = await sendWebhookNotification(
            webhookData,
            parsedData.email || email,
            "testing" // Change to 'prod' for production
          );

          console.log("Webhook notification result:", webhookResult);
        } catch (parseError) {
          console.error("Error parsing resume data:", parseError);
          // Store raw data if parsing fails
          parsedResume = {
            rawData: pythonResponse.parsed_data,
          };

          // Try to send webhook even with raw data
          try {
            webhookResult = await sendWebhookNotification(
              { rawData: pythonResponse.parsed_data },
              email,
              "testing"
            );
          } catch (webhookError) {
            console.error("Error sending webhook notification:", webhookError);
          }
        }
      }

      // Create a new application record
      const application = new Application({
        name,
        email,
        phone,
        cv: {
          fileName: cvFile.name,
          fileType: cvFile.type,
          fileSize: cvFile.size,
          url: fileUrl,
          pythonAnalysis: pythonResponse, // Store the raw Python analysis
        },
        parsedResume: parsedResume, // Add the structured parsed data
        webhookSent: webhookResult?.success || false, // Track webhook status
        webhookResponse: webhookResult, // Store webhook response
      });

      // Save to the database
      await application.save();

      return NextResponse.json(
        {
          success: true,
          message: "Application submitted successfully",
          applicationId: application._id,
          webhookSent: webhookResult?.success || false,
        },
        { status: 201 }
      );
    } catch (uploadError) {
      console.error(
        "Error during file upload or database operation:",
        uploadError
      );
      return NextResponse.json(
        {
          error:
            "Error processing application: " +
            (uploadError instanceof Error
              ? uploadError.message
              : String(uploadError)),
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error handling application submission:", error);
    return NextResponse.json(
      { error: "Error processing your application" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await dbConnect();

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "10");
    const page = parseInt(searchParams.get("page") || "1");
    const status = searchParams.get("status");

    // Build query
    const query: QueryParams = {};
    if (status) query.status = status;

    // Get total count for pagination
    const total = await Application.countDocuments(query);

    // Get paginated results
    const applications = (await Application.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip((page - 1) * limit)
      .select("-__v")) as IApplication[]; // Exclude version field

    return NextResponse.json(
      {
        success: true,
        data: applications,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error retrieving applications:", error);
    return NextResponse.json(
      { error: "Error retrieving applications" },
      { status: 500 }
    );
  }
}
