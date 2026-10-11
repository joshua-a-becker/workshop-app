import React from "react";
import { Button } from "../components/Button.jsx";

export function IntroductionConsent({ next, previous, index }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full p-8 md:p-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
            Information on Research Study
          </h1>
          <div className="w-24 h-1 bg-indigo-600 mx-auto rounded-full"></div>
        </div>

        <div className="space-y-6 text-gray-700">
          <div className="bg-blue-50 border-l-4 border-blue-500 p-5 rounded-r-lg">
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Research Data Collection</h2>
            <p className="text-base leading-relaxed">
              These free educational resources are part of a research study by Prof. Joshua Becker at University College London, School of Management. 
            </p>
            <br/>
            <p className="text-base leading-relaxed">
              On the next page, we'll ask for your consent to participate.
            </p>
            <br/>
            <p className="text-base leading-relaxed">          
              We record video discussions and negotiation proposals. You can turn off your camera and microphone at any time, including before starting. 
            </p>
            <br/>
            <p className="text-base leading-relaxed">
              This research will help improve negotiation teaching and practice, including our ongoing work supporting decision-making in charitable enterprises.
            </p>
            <p><br/>
              <b>We will never share your personal data with anyone.</b>
            </p>
            <p><br/>
              To use these exercises without taking part in the study, email joshua.becker@ucl.ac.uk for access information.
            </p>
          </div>

        
        </div>

        <div className="mt-8 flex justify-center items-center gap-4">
          {index > 0 && (
            <Button handleClick={previous} primary>
              <span className="text-lg px-4">Back</span>
            </Button>
          )}
          <Button handleClick={next} autoFocus>
            <span className="text-lg px-4">Continue</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
