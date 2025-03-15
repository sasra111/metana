from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests
import tempfile
import os
import time
import logging
from PyPDF2 import PdfReader
import openai
from openai import OpenAI
from openai._base_client import SyncHttpxClientWrapper
import json
import datetime
from dotenv import load_dotenv

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create temp directory for files
TEMP_DIR = tempfile.mkdtemp()
logger.info(f"Using temporary directory: {TEMP_DIR}")

app = FastAPI()


# Fix OpenAI's client wrapper
class CustomHttpxClientWrapper(SyncHttpxClientWrapper):
    def __init__(self, *args, **kwargs):
        kwargs.pop("proxies", None)  # Remove unsupported `proxies` argument
        super().__init__(*args, **kwargs)


openai._base_client.SyncHttpxClientWrapper = CustomHttpxClientWrapper

load_dotenv()  # Loads variables from .env into environment
api_key = os.getenv('OPENAI_API_KEY')

class ResumeLink(BaseModel):
    url: str


def download_pdf(url: str) -> str:
    try:
        logger.info(f"Downloading PDF from: {url}")
        # Add timeout to avoid hanging
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        # Use a unique filename in temp directory
        filename = os.path.join(TEMP_DIR, f"resume_{int(time.time())}.pdf")
        with open(filename, "wb") as f:
            f.write(response.content)

        logger.info(f"PDF downloaded successfully to {filename}")
        return filename
    except requests.RequestException as e:
        logger.error(f"Error downloading PDF: {e}")
        raise HTTPException(status_code=400, detail=f"Error downloading file: {e}")


def read_pdf(file_path):
    try:
        logger.info(f"Reading PDF from {file_path}")
        reader = PdfReader(file_path)
        text = ""

        for page in reader.pages:
            text += page.extract_text() + "\n"

        logger.info(f"Extracted {len(text)} characters from PDF")
        return text.strip()
    except Exception as e:
        logger.error(f"Error reading PDF: {e}")
        raise HTTPException(status_code=500, detail=f"Error reading PDF file: {e}")


def ats_extractor(resume_data):
    try:
        logger.info("Processing resume with OpenAI")
        prompt = """
        You are an AI bot designed to act as a professional for parsing resumes. You are given a resume and your job is to extract the following information:
        1. Full Name
        2. Email ID
        3. GitHub Portfolio
        4. LinkedIn ID
        5. Employment Details (with company names, positions, and dates)
        6. Technical Skills (as array of strings)
        7. Soft Skills (as array of strings)
        8. Education (with institution names, degrees, and dates)
        
        Return the extracted information in JSON format only, with keys: fullName, email, github, linkedin, employment, technicalSkills, softSkills, education.
        """

        openai_client = OpenAI(api_key=api_key)

        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": resume_data},
        ]

        response = openai_client.chat.completions.create(
            model="gpt-3.5-turbo", messages=messages, temperature=0.0, max_tokens=1500
        )

        parsed_data = response.choices[0].message.content
        logger.info("Resume successfully parsed by OpenAI")
        return parsed_data
    except Exception as e:
        logger.error(f"Error in ATS extractor: {e}")
        return {"error": str(e)}


origins = [
    "http://localhost:3000",  # Frontend origin
    "*",  # For development - restrict this in production
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "OK"}


# Add this function to send webhook notifications
async def send_webhook(data, candidate_email, environment="testing"):
    """
    Send processed CV data to webhook endpoint with the required structure

    Args:
        data: The processed CV data
        candidate_email: Email of the candidate
        environment: Either "testing" or "prod"
    """
    webhook_url = "https://rnd-assignment.automations-3d6.workers.dev/"

    try:
        logger.info(f"Sending webhook notification for {candidate_email}")

        headers = {
            "Content-Type": "application/json",
            "X-Candidate-Email": candidate_email,
        }

        # Parse the data if it's a string
        parsed_json = {}
        if isinstance(data, str):
            try:
                parsed_json = json.loads(data)
            except json.JSONDecodeError:
                parsed_json = {"raw_text": data}
        else:
            parsed_json = data

        # Extract candidate name if available
        candidate_name = parsed_json.get("fullName", "Unknown Candidate")

        # Format the data according to the expected payload structure
        payload = {
            "cv_data": {
                "personal_info": {
                    "name": parsed_json.get("fullName", ""),
                    "email": parsed_json.get("email", candidate_email),
                    "github": parsed_json.get("github", ""),
                    "linkedin": parsed_json.get("linkedin", ""),
                },
                "education": parsed_json.get("education", []),
                "qualifications": parsed_json.get("technicalSkills", []),
                "projects": [],  # Not directly provided in the parsed data
                "cv_public_link": resume_link.url if "resume_link" in globals() else "",
            },
            "metadata": {
                "applicant_name": candidate_name,
                "email": candidate_email,
                "status": environment,
                "cv_processed": True,
                "processed_timestamp": datetime.datetime.now().isoformat(),
            },
        }

        # For employment history, try to format it if available
        if "employment" in parsed_json:
            # Add employment details to qualifications or relevant section
            payload["cv_data"]["work_experience"] = parsed_json["employment"]

        # Send the webhook request
        webhook_response = requests.post(
            webhook_url, headers=headers, json=payload, timeout=10
        )

        webhook_response.raise_for_status()
        logger.info(
            f"Webhook notification sent successfully: {webhook_response.status_code}"
        )
        return {"status": "success", "response": webhook_response.text}

    except Exception as e:
        logger.error(f"Error sending webhook notification: {e}")
        return {"status": "error", "error": str(e)}


# Update the parse-resume endpoint to include webhook notification
@app.post("/parse-resume/")
async def parse_resume(resume_link: ResumeLink):
    try:
        logger.info(f"Processing resume from URL: {resume_link.url}")
        pdf_path = download_pdf(resume_link.url)
        resume_text = read_pdf(pdf_path)
        parsed_data = ats_extractor(resume_text)

        # Clean up the file
        try:
            os.remove(pdf_path)
            logger.info(f"Removed temporary file: {pdf_path}")
        except Exception as e:
            logger.warning(f"Error removing temporary file: {e}")

        # Try to extract email from parsed data
        candidate_email = ""
        candidate_data = {}

        try:
            if isinstance(parsed_data, str):
                candidate_data = json.loads(parsed_data)
                if "email" in candidate_data:
                    candidate_email = candidate_data["email"]
            elif isinstance(parsed_data, dict):
                candidate_data = parsed_data
                if "email" in candidate_data:
                    candidate_email = candidate_data["email"]
        except Exception as e:
            logger.warning(f"Could not extract email from parsed data: {e}")

        # If we couldn't get the email from parsed data, use a fallback
        if not candidate_email:
            candidate_email = "candidate@example.com"  # You can adjust this fallback

        # Add CV URL to the parsed data
        if isinstance(candidate_data, dict):
            candidate_data["cvUrl"] = resume_link.url

        # Send webhook notification
        webhook_result = await send_webhook(candidate_data, candidate_email)
        logger.info(f"Webhook notification result: {webhook_result['status']}")

        logger.info("Successfully processed resume")
        return {"parsed_data": parsed_data, "webhook_result": webhook_result}
    except Exception as e:
        logger.error(f"Error in parse_resume endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
