import { LEGAL as L } from '../config/legal';

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  list?: string[];
  links?: { to: string; label: string }[];
}

export interface LegalContent {
  path: string;
  title: string;
  metaDescription: string;
  h1: string;
  intro: string;
  sections: LegalSection[];
  /** Show the contact card (email, phone, address) under the content. */
  showContact: boolean;
}

const policyLinks = [
  { to: '/terms', label: 'Terms of Service' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/refund-policy', label: 'Refund & Cancellation Policy' },
];

// ───────────────────────────────────────────────────────────── Terms
export const termsContent: LegalContent = {
  path: '/terms',
  title: 'Terms of Service — Cap or Not',
  metaDescription: 'The rules for using Cap or Not: what the service does, free checks and paid reports, acceptable use, and our limits of liability.',
  h1: 'Terms of Service',
  intro: `These terms apply when you use ${L.siteName} at ${L.siteUrl}. Last updated ${L.effectiveDate}. By using the site you agree to them. If you do not agree, please do not use it.`,
  showContact: true,
  sections: [
    {
      heading: 'Who we are',
      paragraphs: [`${L.siteName} is an online service ("we", "us"). ${L.operatorName ? `It is operated by ${L.operatorName}. ` : ''}You can reach us at ${L.contactEmail}.`],
    },
    {
      heading: 'What the service does',
      paragraphs: [
        'You paste a job posting, recruiter message or offer letter, and we analyse it for common risk signals and give you a report with the evidence behind each point.',
        'The report is a set of indicators to help you decide. It is not a verdict, a guarantee that an opportunity is genuine or fraudulent, or legal, financial or professional advice. Parts of the analysis are automated and can be wrong or incomplete. Always verify an employer through official channels before you pay money or share personal documents.',
      ],
    },
    {
      heading: 'Who can use it',
      paragraphs: ['You must be at least 18 years old, or use the service with a parent or guardian who agrees to these terms.'],
    },
    {
      heading: 'What you submit',
      paragraphs: [
        'You confirm that you are entitled to submit the text you paste. We process it only to produce your report and run the service, as described in our Privacy Policy. You keep ownership of what you submit; you give us a limited licence to process and store it for that purpose.',
        'Please do not paste anything the analysis does not need, such as ID numbers, bank or card details, passwords or one-time codes. Remove them first.',
      ],
    },
    {
      heading: 'Free checks and paid reports',
      paragraphs: [
        `Every check shows a free summary. We currently allow up to ${L.freeChecksPerVisitor} free checks per visitor and may change that limit.`,
        `The complete report for a check can be unlocked for a one-time payment of ${L.reportPrice} per report, in Indian rupees, through Razorpay. The amount shown at checkout is the amount you pay. Your report unlocks once the payment is verified.`,
        'Your checks and reports are linked to the browser you used, through a cookie. If you clear your cookies or switch devices you may lose access to them; contact us with your payment details and we will help.',
      ],
      links: [{ to: '/refund-policy', label: 'Refund & Cancellation Policy' }],
    },
    {
      heading: 'Acceptable use',
      paragraphs: ['You agree not to:'],
      list: [
        'use the service for anything unlawful, or to harass or defraud anyone;',
        'send automated or bulk requests, scrape the site, or try to get around the free-check limit or the payment step;',
        'probe, disrupt or reverse-engineer the service or its security;',
        'submit content you have no right to share.',
      ],
    },
    {
      heading: 'Third-party services and links',
      paragraphs: ['Payments are handled by Razorpay under its own terms. Reports may mention websites or companies we do not control, and we are not responsible for them.'],
    },
    {
      heading: 'Availability and changes',
      paragraphs: [
        'We try to keep the service running but do not promise it will always be available or error-free. We may change or stop features, and we may update these terms; the date at the top shows the latest version. Continuing to use the site after a change means you accept it.',
      ],
    },
    {
      heading: 'Disclaimers and limits of liability',
      paragraphs: [
        'The service is provided "as is", without warranties of any kind, to the extent the law allows.',
        'To the extent the law allows, we are not liable for indirect or consequential loss, or for decisions you make or money you lose by relying on a report. Our total liability for any claim relating to the service is limited to the amount you paid us for the report the claim concerns. Nothing in these terms limits any liability that cannot be limited by law.',
      ],
    },
    {
      heading: 'Governing law and disputes',
      paragraphs: [`These terms are governed by the laws of India. If something goes wrong, please email us first at ${L.contactEmail} and we will try to sort it out. Nothing here takes away rights you have as a consumer under Indian law.`],
    },
    {
      heading: 'Contact',
      paragraphs: [`Questions about these terms: ${L.contactEmail}.`],
      links: [policyLinks[1], policyLinks[2]],
    },
  ],
};

// ───────────────────────────────────────────────────────────── Privacy
export const privacyContent: LegalContent = {
  path: '/privacy',
  title: 'Privacy Policy — Cap or Not',
  metaDescription: 'What Cap or Not collects when you check a job or internship offer, how it is used and stored, who it is shared with, and how to ask for deletion.',
  h1: 'Privacy Policy',
  intro: `This explains what ${L.siteName} collects, why, and the choices you have. Last updated ${L.effectiveDate}.`,
  showContact: true,
  sections: [
    {
      heading: 'What we collect',
      list: [
        'What you submit for a check: the text you paste and any details you enter, such as the company name, recruiter name and email, website, job title or link, and offer-letter text. We store it together with your result.',
        'An anonymous ID cookie (co_uid). It links your checks, your free-check count and your paid reports to your browser. There is no account, password or email sign-up.',
        'Payment records: when you pay, Razorpay collects your payment details. We receive and store only the order ID, payment ID, amount, status and timestamps. We never see or store your card or UPI details.',
        'Technical data: your IP address is used to limit abusive traffic and is not saved in our database. Our hosting provider also processes it to deliver the site.',
      ],
    },
    {
      heading: 'What we do not do',
      list: [
        'We do not sell your data.',
        'We do not use advertising or analytics trackers on the site.',
        'We do not ask you to create an account or give us your email to run a check.',
      ],
    },
    {
      heading: 'How we use it',
      list: [
        'To analyse what you submit and produce your report.',
        'To process payments, unlock paid reports and give support.',
        'To keep the service secure and prevent abuse.',
      ],
    },
    {
      heading: 'Who it is shared with',
      paragraphs: ['We use these providers to run the service. They process data on our behalf:'],
      list: [
        'Cloudflare: hosting and delivery, and AI models that help read the text you submit.',
        'Supabase: the database where your submissions, results and payment records are stored (hosted by AWS in Singapore).',
        'Razorpay: payment processing.',
        'AI language-model services: parts of your submitted text may be processed by AI models (Cloudflare Workers AI and, where enabled, OpenRouter and the model providers it routes to) so the analysis can read the posting. Each provider handles that data under its own terms.',
        'Public lookups: to check a company website you give us, we may look up the registration date of its domain in public registries and send a request to the website to see whether it responds. These requests contain the web address, not your pasted text.',
      ],
      links: [],
    },
    {
      heading: 'Where your data is processed',
      paragraphs: ['Our providers run servers in several countries, including outside India. By using the service you accept that your data may be processed there.'],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        'We keep your submissions and reports so you can reopen your result. We do not currently delete them automatically, so ask us if you want something removed (see below). We keep payment records for as long as the law and our accounts require.',
      ],
    },
    {
      heading: 'Your choices and rights',
      paragraphs: [
        `You can ask us to show you the data linked to your reports, correct it, or delete a report and what you submitted. Email ${L.contactEmail} from a message that includes your report link (it looks like ${L.siteUrl}/result/…) or payment ID so we can find it. We will reply within ${L.supportResponseTime}. Because we have no account system, we may ask for proof that the request relates to your reports.`,
        'You can delete the co_uid cookie in your browser at any time. This will cut your access to earlier reports and reset your free-check count on that browser.',
      ],
    },
    {
      heading: 'Cookies',
      paragraphs: [
        'We set one essential cookie (co_uid) that lasts up to two years. The site does not work properly without it. When you open the payment window, Razorpay may set its own cookies under its own policy.',
      ],
    },
    {
      heading: 'Security',
      paragraphs: ['Traffic to the site is encrypted, and access to the database is restricted. No system is completely secure, so we cannot guarantee absolute security.'],
    },
    {
      heading: 'Children',
      paragraphs: ['The service is not meant for anyone under 18, and we do not knowingly collect data from children.'],
    },
    {
      heading: 'Changes and contact',
      paragraphs: [`We may update this policy and will change the date above when we do. Privacy questions or complaints: ${L.contactEmail}.`],
      links: [policyLinks[0], policyLinks[2]],
    },
  ],
};

// ───────────────────────────────────────────────────────────── Refunds
export const refundContent: LegalContent = {
  path: '/refund-policy',
  title: 'Refund & Cancellation Policy — Cap or Not',
  metaDescription: 'How refunds and cancellations work for Cap or Not paid reports: when we refund, how to ask, and how long it takes.',
  h1: 'Refund & Cancellation Policy',
  intro: `Last updated ${L.effectiveDate}. This covers the paid full report (${L.reportPrice}, one time per report). Free checks cost nothing and need no refund.`,
  showContact: true,
  sections: [
    {
      heading: 'What you are buying',
      paragraphs: ['A digital report that unlocks on your screen as soon as your payment is verified. Nothing is shipped, so no delivery fee or waiting period applies.'],
    },
    {
      heading: 'Cancellation',
      paragraphs: ['You can close the payment window at any time before you pay, and you are not charged. Once a payment is verified and the report is unlocked, it is delivered and cannot be cancelled.'],
    },
    {
      heading: 'When we refund',
      paragraphs: [`Send us a request within ${L.refundRequestWindowDays} days of the payment and we will refund you if:`],
      list: [
        'you were charged but the full report did not unlock and we cannot fix it for you;',
        'you were charged more than once for the same report;',
        'you were charged an amount different from the price shown at checkout;',
        'a technical fault on our side stops the report from working and we cannot resolve it.',
      ],
    },
    {
      heading: 'When we do not refund',
      list: [
        'The report unlocked and worked as described, and you simply changed your mind or disagree with the assessment. The report gives risk indicators, not a verdict.',
        'The request comes after the window above, unless the law requires otherwise.',
        'You lost access because you cleared your cookies or changed device. We will restore access to a report you paid for instead; contact us with your payment details.',
      ],
    },
    {
      heading: 'If money left your account but nothing unlocked',
      paragraphs: [
        `Failed or interrupted payments are usually reversed automatically by your bank or Razorpay within ${L.refundProcessingTime}. If your money has not returned after that, or the report is still locked, email us with the payment ID and we will sort it out.`,
      ],
    },
    {
      heading: 'How to ask for a refund',
      paragraphs: [
        `Email ${L.contactEmail} with the subject "Refund request" and include:`,
      ],
      list: [
        'the payment ID shown in your Razorpay receipt or bank message,',
        'your report link (it looks like ' + L.siteUrl + '/result/…),',
        'a short note on what went wrong.',
      ],
    },
    {
      heading: 'How refunds are paid',
      paragraphs: [
        `Approved refunds go back to the original payment method through Razorpay. We reply to requests within ${L.supportResponseTime}, and the money usually reaches you in ${L.refundProcessingTime}, depending on your bank.`,
        'Please contact us before raising a dispute with your bank so we can fix it faster.',
      ],
    },
    {
      heading: 'Related policies',
      links: [policyLinks[0], policyLinks[1]],
    },
  ],
};

// ───────────────────────────────────────────────────────────── Contact
export const contactContent: LegalContent = {
  path: '/contact',
  title: 'Contact Us — Cap or Not',
  metaDescription: 'How to reach Cap or Not for support, refunds, privacy requests and feedback.',
  h1: 'Contact Us',
  intro: `Questions, a problem with a payment, or a request about your data? Email us and we will reply within ${L.supportResponseTime}.`,
  showContact: true,
  sections: [
    {
      heading: 'What to include',
      list: [
        'Payment problem or refund: the payment ID from your Razorpay receipt or bank message, and your report link.',
        'Report problem: your report link (' + L.siteUrl + '/result/…) and what you expected to see.',
        'Data request (see or delete what you submitted): your report link or payment ID so we can find it.',
        'Feedback about a wrong finding: the finding and what the posting actually said. Please remove personal details first.',
      ],
    },
    {
      heading: 'Our policies',
      links: policyLinks,
    },
  ],
};

export const LEGAL_PAGES: LegalContent[] = [termsContent, privacyContent, refundContent, contactContent];