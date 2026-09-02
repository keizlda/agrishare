// Content for the static More-menu screens (rendered by InfoScreen.js).
// Kept as data rather than inline JSX so it's easy to hand off for review —
// this is real policy/support copy, not placeholder text.

export const termsContent = {
  title: "Terms and Conditions",
  sections: [
    {
      heading: "Who this is for",
      body: "AgriShare is provided by the Municipal Agriculture Office (MAO) of Labangan, Zamboanga del Sur for registered farmers of Barangay Langapud enrolled under the Registry System for Basic Sectors in Agriculture (RSBSA). Access is limited to farmers with a valid RSBSA number on file with the MAO.",
    },
    {
      heading: "Your account",
      body: "Your RSBSA number and password are for your use only. You're responsible for keeping your password private and for the accuracy of what you submit — including crop validation photos, GPS location, and commodity requests. Contact your FA President or the MAO if you believe your account has been accessed without your permission.",
    },
    {
      heading: "Submissions",
      body: "Crop validation photos and location data you submit are reviewed by MAO staff or your FA President to verify planting and eligibility for commodity distributions. Submitting false or misleading information may affect your eligibility for current or future assistance programs.",
    },
    {
      heading: "Commodity requests and distributions",
      body: "Requesting a commodity through the app does not guarantee approval. All requests are reviewed and approved at the discretion of your FA President and the MAO based on availability and eligibility. Distribution schedules shown in the app may change; always confirm with your barangay coordinator.",
    },
    {
      heading: "Changes to these terms",
      body: "These terms may be updated as the system evolves. Continued use of AgriShare after a change means you accept the updated terms.",
    },
    {
      heading: "Questions",
      body: "For questions about these terms, contact the Municipal Agriculture Office of Labangan or your FA President.",
    },
  ],
};

export const privacyContent = {
  title: "Privacy Policy",
  sections: [
    {
      heading: "What we collect",
      body: "Your RSBSA number, name, sex, birth date, contact number, and address; your farm's location, size, and crops; and, when you submit a crop validation, a photo along with its GPS coordinates and the time it was taken.",
    },
    {
      heading: "Why we collect it",
      body: "To verify your identity and eligibility as a registered farmer, to confirm that assistance (seeds, fertilizer, tools) was actually planted where and when claimed, and to process your commodity requests and distribution records.",
    },
    {
      heading: "Who can see it",
      body: "Your information is visible to MAO Admin staff and your barangay's FA President for the purpose of reviewing and approving your submissions and requests. It is not shared outside the Municipal Agriculture Office or sold to any third party.",
    },
    {
      heading: "How it's protected",
      body: "Access to farmer records is restricted by account role — a farmer account can only see its own records, never another farmer's. Crop validation photos are stored privately and are never made public.",
    },
    {
      heading: "How long we keep it",
      body: "Your records are kept for as long as you're an active RSBSA-registered farmer under the MAO's programs, consistent with the office's recordkeeping requirements under the Data Privacy Act of 2012 (RA 10173).",
    },
    {
      heading: "Your rights",
      body: "You may request to see, correct, or ask about the data held about you by contacting your FA President or the Municipal Agriculture Office directly.",
    },
  ],
};

export const aboutContent = {
  title: "About AGRISHARE",
  sections: [
    {
      heading: "What this is",
      body: "AgriShare is a digital record-keeping and coordination tool built for the Municipal Agriculture Office (MAO) of Labangan, Zamboanga del Sur, serving registered farmers of Barangay Langapud.",
    },
    {
      heading: "What you can do here",
      body: "View your farmer profile and RSBSA record, submit geotagged proof of planting for crop validation, track commodity distributions you've received, request additional commodities from your FA President, and stay updated through office announcements.",
    },
    {
      heading: "Version",
      body: "App Version 1.0.0.",
    },
  ],
};

export const faqContent = {
  title: "FAQs",
  sections: [
    {
      heading: "How do I submit a crop validation?",
      body: "Open Crop Validation from the tab bar, tap New Validation, capture your GPS location first, then take a photo of your planted crop. The app stamps the photo with your location and the date before submitting it for review.",
    },
    {
      heading: "Why does the app need my camera and location?",
      body: "Crop validation photos need to be geotagged so the MAO can confirm assistance was planted where and when you say it was. The app never accesses your camera or location outside of that submission flow.",
    },
    {
      heading: "How do I know if my submission was approved?",
      body: "Open Crop Validation to see the status of every submission you've made — Pending, Validated, or Rejected. If rejected, the reviewer's reason is shown with it.",
    },
    {
      heading: "What happens after I request a commodity?",
      body: "Your request goes to your FA President for review, then to the MAO for final approval. You can check its status anytime under Commodity Requests.",
    },
    {
      heading: "I forgot my password. What do I do?",
      body: "Use Change Password from the More menu if you're still logged in. If you're locked out entirely, contact your FA President or the MAO to have it reset.",
    },
  ],
};

export const helpCenterContent = {
  title: "Help Center",
  sections: [
    {
      heading: "Getting started",
      body: "Log in with your RSBSA number and the password given to you by the MAO. If this is your first time logging in, contact your FA President to confirm your account is active.",
    },
    {
      heading: "Submitting a crop validation",
      body: "From the Validation tab, tap New Validation. Capture your GPS location first — the photo step needs it. Then take a photo of your planted crop; it gets stamped with your location and submitted automatically.",
    },
    {
      heading: "Requesting commodities",
      body: "From the More menu, open Commodity Requests, tap New Request, choose a commodity and quantity, and explain why you need it. Your FA President reviews it first, then the MAO gives final approval.",
    },
    {
      heading: "Checking distributions",
      body: "The Distributions tab shows what you've already received and what's scheduled. Tap any entry for the full date, venue, and quantity.",
    },
    {
      heading: "Still stuck?",
      body: "Use Contact Support from the More menu to reach the Municipal Agriculture Office directly.",
    },
  ],
};
