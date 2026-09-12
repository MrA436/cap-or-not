import { useState, useRef, useEffect } from 'react';
import type { OpportunityInput } from '@/types/analysis';
import { Building2, User, Mail, Globe, Briefcase, Link as LinkIcon, FileCheck, Upload, ShieldCheck, Loader2, Lock, ChevronDown, Sparkles } from 'lucide-react';

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
          rows={4}
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

// Lightweight, best-effort extraction — this only needs to save the person
// a copy-paste, not be perfect. If it misses, the field is still right
// there, editable.
function extractFirstEmail(text: string): string | null {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)>\]"']+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:!?]+$/, '');
}

export default function OpportunityForm({ onSubmit, isAnalyzing }: OpportunityFormProps) {
  const [pasteContent, setPasteContent] = useState('');
  const [company, setCompany] = useState('');
  const [recruiterName, setRecruiterName] = useState('');
  const [recruiterEmail, setRecruiterEmail] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [jobPostingUrl, setJobPostingUrl] = useState('');
  const [offerLetter, setOfferLetter] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tracks the last value WE auto-filled, so we know whether the person
  // has since edited it by hand — if so, we stop overwriting it.
  const autofilledEmail = useRef<string | null>(null);
  const autofilledWebsite = useRef<string | null>(null);

  useEffect(() => {
    const foundEmail = extractFirstEmail(pasteContent);
    if (foundEmail && (recruiterEmail === '' || recruiterEmail === autofilledEmail.current)) {
      setRecruiterEmail(foundEmail);
      autofilledEmail.current = foundEmail;
    }
    const foundUrl = extractFirstUrl(pasteContent);
    if (foundUrl && (companyWebsite === '' || companyWebsite === autofilledWebsite.current)) {
      setCompanyWebsite(foundUrl);
      autofilledWebsite.current = foundUrl;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasteContent]);

  const hasContent = pasteContent.trim().length > 0 || company || recruiterName || recruiterEmail || companyWebsite || jobTitle || offerLetter;

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
      jobTitle, jobPostingUrl,
      description: '',
      recruiterMessage: pasteContent,
      offerLetter, agreeToTerms,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2.5">
        <Lock className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Do not paste passwords, OTPs, bank credentials, or highly sensitive personal information.</span>
          {' '}We only analyze information you choose to submit.
        </p>
      </div>

      {/* Hero input — this alone is enough to run a check. Everything else
          is optional and either auto-filled or tucked away. */}
      <div>
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-1.5">
          Paste the message, email, or job posting
        </label>
        <textarea
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
          placeholder="Paste everything you've got — the recruiter's message, the job posting, the offer letter, an email thread. Don't worry about tidying it up."
          rows={8}
          autoFocus
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors resize-y"
        />
      </div>

      {/* Auto-detected fields — filled live from the paste above, always
          visible and editable so the person can see (and fix) what we
          picked up, without having to type it themselves. */}
      {(recruiterEmail || companyWebsite || pasteContent.trim()) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-gray-500 mb-1.5">
              <Globe className="w-3.5 h-3.5 text-gray-400" />
              Company website
              {companyWebsite && companyWebsite === autofilledWebsite.current && (
                <span className="inline-flex items-center gap-1 text-[10px] text-blue-500"><Sparkles className="w-3 h-3" />auto-detected</span>
              )}
            </label>
            <input
              type="text"
              value={companyWebsite}
              onChange={(e) => setCompanyWebsite(e.target.value)}
              placeholder="https://company.com"
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors"
            />
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-gray-500 mb-1.5">
              <Mail className="w-3.5 h-3.5 text-gray-400" />
              Recruiter email
              {recruiterEmail && recruiterEmail === autofilledEmail.current && (
                <span className="inline-flex items-center gap-1 text-[10px] text-blue-500"><Sparkles className="w-3 h-3" />auto-detected</span>
              )}
            </label>
            <input
              type="text"
              value={recruiterEmail}
              onChange={(e) => setRecruiterEmail(e.target.value)}
              placeholder="recruiter@company.com"
              className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Everything else — optional, collapsed by default so it never
          blocks a fast check, but available for anyone who wants a more
          thorough result. */}
      <div>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showMore ? 'rotate-180' : ''}`} />
          {showMore ? 'Hide extra details' : 'Add more details (optional, improves accuracy)'}
        </button>

        {showMore && (
          <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field icon={Building2} label="Company name" placeholder="e.g. Acme Technologies" value={company} onChange={setCompany} />
              <Field icon={User} label="Recruiter name" placeholder="e.g. John Smith" value={recruiterName} onChange={setRecruiterName} />
              <Field icon={Briefcase} label="Job / internship title" placeholder="e.g. Software Engineering Intern" value={jobTitle} onChange={setJobTitle} />
              <Field icon={LinkIcon} label="Job posting URL" placeholder="LinkedIn, Indeed, careers page, etc." value={jobPostingUrl} onChange={setJobPostingUrl} />
            </div>
            <Field icon={FileCheck} label="Offer letter (if separate from what you pasted above)" placeholder="Paste offer letter text here if you have one..." value={offerLetter} onChange={setOfferLetter} type="textarea" />

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
          </div>
        )}
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
        <p className="text-center text-sm text-gray-400">Paste something above to begin.</p>
      )}
    </form>
  );
}