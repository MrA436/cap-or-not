import { useState, useRef } from 'react';
import type { OpportunityInput } from '@/types/analysis';
import { Building2, User, Mail, Globe, Briefcase, Link as LinkIcon, FileText, MessageSquare, FileCheck, Upload, ShieldCheck, Loader2, Lock } from 'lucide-react';

interface OpportunityFormProps {
  onSubmit: (input: OpportunityInput) => void;
  isAnalyzing: boolean;
}

interface FieldProps {
  icon: typeof Building2;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'textarea';
  required?: boolean;
}

function Field({ icon: Icon, label, placeholder, value, onChange, type = 'text' }: FieldProps) {
  return (
    <div>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
        <Icon className="w-4 h-4 text-gray-400" />
        {label}
      </label>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={5}
          className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors resize-y"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors"
        />
      )}
    </div>
  );
}

export default function OpportunityForm({ onSubmit, isAnalyzing }: OpportunityFormProps) {
  const [company, setCompany] = useState('');
  const [recruiterName, setRecruiterName] = useState('');
  const [recruiterEmail, setRecruiterEmail] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobPostingUrl, setJobPostingUrl] = useState('');
  const [description, setDescription] = useState('');
  const [recruiterMessage, setRecruiterMessage] = useState('');
  const [offerLetter, setOfferLetter] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasContent = company || recruiterName || recruiterEmail || companyWebsite || jobTitle || description || recruiterMessage || offerLetter;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileError(null);

    const allowedTypes = ['application/pdf', 'text/plain', 'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const allowedExtensions = ['.pdf', '.txt', '.md', '.docx'];
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(ext)) {
      setFileError('Unsupported file type. Please upload PDF, TXT, or DOCX files.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFileError('File too large. Please upload files under 5 MB.');
      return;
    }

    setFileName(file.name);

    try {
      if (ext === '.txt' || ext === '.md' || file.type === 'text/plain') {
        const text = await file.text();
        setOfferLetter((prev) => prev ? `${prev}\n\n--- ${file.name} ---\n${text}` : text);
      } else {
        setOfferLetter((prev) => prev
          ? `${prev}\n\n--- ${file.name} (uploaded — content extraction for this format is limited in the MVP) ---`
          : `--- ${file.name} (uploaded — content extraction for this format is limited in the MVP) ---`);
      }
    } catch {
      setFileError('Could not read the file. Try pasting the content directly.');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasContent || !agreeToTerms || isAnalyzing) return;
    onSubmit({
      company, recruiterName, recruiterEmail, companyWebsite,
      jobTitle, jobPostingUrl, description, recruiterMessage, offerLetter, agreeToTerms,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2.5">
        <Lock className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Do not paste passwords, OTPs, bank credentials, or highly sensitive personal information.</span>
          {' '}We only analyze information you choose to submit.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field icon={Building2} label="Company" placeholder="e.g. Acme Technologies" value={company} onChange={setCompany} />
        <Field icon={User} label="Recruiter name" placeholder="e.g. John Smith" value={recruiterName} onChange={setRecruiterName} />
        <Field icon={Mail} label="Recruiter email" placeholder="e.g. john@company.com" value={recruiterEmail} onChange={setRecruiterEmail} />
        <Field icon={Globe} label="Company website" placeholder="https://company.com" value={companyWebsite} onChange={setCompanyWebsite} />
        <Field icon={Briefcase} label="Job / internship title" placeholder="e.g. Software Engineering Intern" value={jobTitle} onChange={setJobTitle} />
        <Field icon={LinkIcon} label="Job posting URL" placeholder="Paste the LinkedIn, Indeed, company careers, or other job URL" value={jobPostingUrl} onChange={setJobPostingUrl} />
      </div>

      <Field icon={FileText} label="Opportunity description" placeholder="Paste the job or internship description here..." value={description} onChange={setDescription} type="textarea" />
      <Field icon={MessageSquare} label="Recruiter message" placeholder="Paste the LinkedIn, WhatsApp, email, Telegram, or other recruiter message here..." value={recruiterMessage} onChange={setRecruiterMessage} type="textarea" />
      <Field icon={FileCheck} label="Offer letter / additional information" placeholder="Paste any offer letter text, instructions, payment requests, or other details..." value={offerLetter} onChange={setOfferLetter} type="textarea" />

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
          <Upload className="w-4 h-4 text-gray-400" />
          Upload document
        </label>
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
        >
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          {fileName ? (
            <p className="text-sm text-gray-700 font-medium">{fileName}</p>
          ) : (
            <>
              <p className="text-sm text-gray-600">Click to upload a document</p>
              <p className="text-xs text-gray-400 mt-1">PDF, TXT, or DOCX (max 5 MB)</p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.docx"
          onChange={handleFileUpload}
          className="hidden"
        />
        {fileError && <p className="text-sm text-red-600 mt-2">{fileError}</p>}
      </div>

      <label className="flex items-start gap-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={agreeToTerms}
          onChange={(e) => setAgreeToTerms(e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-600">
          I understand that Cap or Not provides indicators, not a definitive scam determination.
        </span>
      </label>

      <button
        type="submit"
        disabled={!hasContent || !agreeToTerms || isAnalyzing}
        className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-lg transition-colors"
      >
        {isAnalyzing ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Checking for cap...
          </>
        ) : (
          <>
            <ShieldCheck className="w-5 h-5" />
            CAP CHECK IT
          </>
        )}
      </button>

      {!hasContent && (
        <p className="text-center text-sm text-gray-400">Fill in at least one field to begin analysis.</p>
      )}
    </form>
  );
}
