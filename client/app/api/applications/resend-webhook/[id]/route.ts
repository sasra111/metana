import { NextRequest, NextResponse } from "next/server";
import dbConnect from "@/lib/mongodb";
import Application from "@/lib/models/Application";
import { sendWebhookNotification } from "@/lib/webhook";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const { id } = params;

    await dbConnect();

    // Find the application
    const application = await Application.findById(id);

    if (!application) {
      return NextResponse.json(
        { error: "Application not found" },
        { status: 404 }
      );
    }

    // Extract email and parsed resume data
    const email = application.email;
    let data;

    // Get the data to send
    if (application.parsedResume?.rawData) {
      // If we have parsed raw data, use it
      try {
        if (typeof application.parsedResume.rawData === "string") {
          data = JSON.parse(application.parsedResume.rawData);
        } else {
          data = application.parsedResume.rawData;
        }

        // Add CV URL to the data
        data.cvUrl = application.cv.url;
      } catch (e) {
        // If parsing fails, use the structured data
        data = {
          fullName: application.parsedResume?.fullName || application.name,
          email: application.parsedResume?.email || application.email,
          github: application.parsedResume?.github,
          linkedin: application.parsedResume?.linkedin,
          employment: application.parsedResume?.employment,
          technicalSkills: application.parsedResume?.technicalSkills,
          softSkills: application.parsedResume?.softSkills,
          education: application.parsedResume?.education,
          cvUrl: application.cv.url, // Include the CV URL
        };
      }
    } else {
      // Fallback to application data
      data = {
        fullName: application.name,
        email: application.email,
        cvUrl: application.cv.url, // Include the CV URL
      };
    }

    // Send webhook
    const webhookResult = await sendWebhookNotification(
      data,
      email,
      "prod" // Change to 'prod' for production
    );

    // Update application with webhook result
    application.webhookSent = webhookResult.success;
    application.webhookResponse = webhookResult;
    await application.save();

    return NextResponse.json({
      success: true,
      message: "Webhook resent successfully",
      webhookResult,
    });
  } catch (error) {
    console.error("Error resending webhook:", error);
    return NextResponse.json(
      { error: "Error resending webhook" },
      { status: 500 }
    );
  }
}
