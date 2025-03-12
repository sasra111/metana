import axios from "axios";

/**
 * Send processed CV data to webhook
 * @param data - The processed CV data
 * @param email - The candidate's email
 * @param environment - Testing or production environment
 * @returns - Response from the webhook endpoint
 */
export async function sendWebhookNotification(
  data: any,
  email: string,
  environment: "testing" | "prod" = "testing"
): Promise<any> {
  try {
    console.log(`Sending webhook notification for ${email}`);

    // Format the data according to the required structure
    const payload = {
      cv_data: {
        personal_info: {
          name: data.fullName || "",
          email: data.email || email,
          github: data.github || "",
          linkedin: data.linkedin || "",
        },
        education: data.education || [],
        qualifications: data.technicalSkills || [],
        projects: [], // Not directly provided in the parsed data
        cv_public_link: data.cvUrl || "",
      },
      metadata: {
        applicant_name: data.fullName || "Unknown Candidate",
        email: email,
        status: environment,
        cv_processed: true,
        processed_timestamp: new Date().toISOString(),
      },
    };

    // Add employment history if available
    if (data.employment) {
      payload.cv_data.work_experience = data.employment;
    }

    const response = await axios.post(
      "https://rnd-assignment.automations-3d6.workers.dev/",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Candidate-Email": email,
        },
        timeout: 10000, // 10-second timeout
      }
    );

    console.log(`Webhook notification sent successfully: ${response.status}`);
    return {
      success: true,
      status: response.status,
      data: response.data,
    };
  } catch (error: any) {
    console.error("Error sending webhook notification:", error);
    return {
      success: false,
      error: error.message,
      details: error.response?.data,
    };
  }
}

// Add this function for retrying webhooks
export async function retryWebhook(
  data: any,
  email: string,
  retries = 3,
  delay = 2000,
  environment: "testing" | "prod" = "testing"
): Promise<any> {
  let attempt = 0;
  let lastError;

  while (attempt < retries) {
    try {
      attempt++;
      console.log(`Webhook attempt ${attempt}/${retries} for ${email}`);

      const result = await sendWebhookNotification(data, email, environment);

      if (result.success) {
        return result;
      }

      lastError = result.error;
    } catch (error) {
      lastError = error;
    }

    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return {
    success: false,
    error: `Failed after ${retries} attempts. Last error: ${lastError}`,
  };
}
