import React from "react";
import { Button } from "../components/Button.jsx";

export default function CustomConsent({ next, previous, index }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-6">
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full p-10 md:p-14 border border-gray-200">
        {/* Header Section */}
        <div className="border-b-2 border-gray-300 pb-6 mb-8">
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-gray-900 text-center mb-2">
            Research Consent Form
          </h1>
          <p className="text-center text-gray-600 font-medium">
            University College London
          </p>
        </div>

        {/* Document Content */}
        <div className="space-y-6 text-gray-800 leading-relaxed">
          {/* Introduction */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-5">
            <p className="text-base">
              By participating in this activity, you are agreeing to the collection of your data for research on negotiation and decision making.
            </p>
            <p className="text-base mt-3">
              We will be recording the video and chat data in this activity. You can disable your video and sound at any point during the activity.
            </p>
            <p className="text-base mt-3">
              To opt-out of your data being used for research, just email joshua.becker@ucl.ac.uk and proceed to the activity.  This choice will not impact your access to the online course.
            </p>
          </div>

          {/* Purpose */}
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3 font-serif border-l-4 border-indigo-600 pl-4">
              Purpose of the Research
            </h2>
            <p className="text-base ml-5">
              We are trying to understand how people negotiate in classroom exercises to improve negotiation education and practice.
            </p>
          </section>

          {/* Safety Statement */}
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3 font-serif border-l-4 border-amber-600 pl-4">
              Safety Statement
            </h2>
            <p className="text-base ml-5">
              This session is like a typical online classroom. You will be negotiating live with other participants and we cannot control your experience. Negotiation exercises can be challenging, and you may encounter rude or argumentative behavior.
            </p>
          </section>

          {/* Benefits */}
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3 font-serif border-l-4 border-green-600 pl-4">
              Benefits
            </h2>
            <p className="text-base ml-5">
              By participating, you will receive practice negotiating similar to university classroom exercises.  These exercises support learning points found in the lecture videos.
            </p>
          </section>

          {/* Anonymity */}
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3 font-serif border-l-4 border-indigo-600 pl-4">
              Privacy
            </h2>
            <p className="text-base ml-5">
              All data will be anonymized prior to analysis. No identifying information will shared outside this research team. All personal data will be stored securely within a UCL research data environment.

              To request data deletion email joshua.becker@ucl.ac.uk from your registered email.
            </p>
          </section>
        </div>

        {/* Consent Statement */}
        <div className="mt-10 pt-6 border-t-2 border-gray-300">
          <div className="bg-indigo-50 border-2 border-indigo-300 rounded-md p-6">
            <p className="text-base font-semibold text-gray-900 text-center">
              By clicking "I Consent" below, you acknowledge that you have read and understood this consent form and agree to participate in this research study.
            </p>
          </div>
        </div>

        {/* Button */}
        <div className="mt-8 flex justify-center items-center gap-4">
          {index > 0 && (
            <Button handleClick={previous} primary>
              <span className="text-lg px-8 py-1">Back</span>
            </Button>
          )}
          <Button handleClick={next} autoFocus>
            <span className="text-lg px-8 py-1">I Consent</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
