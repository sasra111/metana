import React from "react";
import ApplicationForm from "./components/ApplicationForm";

function page() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <ApplicationForm />
    </div>
  );
}

export default page;
