import mongoose, { Document, Model } from "mongoose";

// Define interfaces for TypeScript type safety

// Interface for CV document details
interface CV {
  fileName: string;
  fileType: string;
  fileSize: number;
  url: string;
  pythonAnalysis?: any;
}

// Interface for parsed resume data
interface ParsedResume {
  fullName?: string;
  email?: string;
  github?: string;
  linkedin?: string;
  employment?: Array<{
    company?: string;
    position?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
  }>;
  technicalSkills?: string[];
  softSkills?: string[];
  education?: Array<{
    institution?: string;
    degree?: string;
    startDate?: string;
    endDate?: string;
  }>;
  rawData?: any; // Store the raw parsed data
}

type ApplicationStatus =
  | "pending"
  | "reviewed"
  | "contacted"
  | "rejected"
  | "hired";

// Interface for Application document
export interface IApplication extends Document {
  name: string;
  email: string;
  phone: string;
  cv: CV;
  parsedResume?: ParsedResume;
  status: ApplicationStatus;
  webhookSent?: boolean;
  webhookResponse?: any;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Define the schema
const applicationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
  },
  email: {
    type: String,
    required: [true, "Email is required"],
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
  },
  phone: {
    type: String,
    required: [true, "Phone number is required"],
    trim: true,
  },
  cv: {
    fileName: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    url: { type: String, required: true },
    pythonAnalysis: { type: mongoose.Schema.Types.Mixed },
  },
  parsedResume: {
    fullName: { type: String },
    email: { type: String },
    github: { type: String },
    linkedin: { type: String },
    employment: [
      {
        company: { type: String },
        position: { type: String },
        startDate: { type: String },
        endDate: { type: String },
        description: { type: String },
      },
    ],
    technicalSkills: [{ type: String }],
    softSkills: [{ type: String }],
    education: [
      {
        institution: { type: String },
        degree: { type: String },
        startDate: { type: String },
        endDate: { type: String },
      },
    ],
    rawData: { type: mongoose.Schema.Types.Mixed },
  },
  status: {
    type: String,
    enum: ["pending", "reviewed", "contacted", "rejected", "hired"],
    default: "pending",
  },
  webhookSent: {
    type: Boolean,
    default: false,
  },
  webhookResponse: {
    type: mongoose.Schema.Types.Mixed,
  },
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

applicationSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

const getApplicationModel = (): Model<IApplication> => {
  return (
    (mongoose.models.Application as Model<IApplication>) ||
    mongoose.model<IApplication>("Application", applicationSchema)
  );
};

// Create the model
const Application = getApplicationModel();

export default Application;
