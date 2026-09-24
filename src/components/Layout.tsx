import { Link, useLocation } from 'react-router-dom';
import { ShieldCheck, Menu, X } from 'lucide-react';
import { useState } from 'react';

export default function Layout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/check', label: 'Check' },
    { to: '/how-it-works', label: 'How It Works' },
  ];

  const isActive = (path: string) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-9 h-9 rounded-lg bg-gray-900 flex items-center justify-center group-hover:bg-gray-800 transition-colors">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-gray-900 text-lg tracking-tight">Cap or Not</span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`px-3.5 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(link.to)
                    ? 'text-gray-900 bg-gray-100'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/check"
              className="ml-2 px-4 py-2 rounded-md text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 transition-colors"
            >
              Cap Check It
            </Link>
          </nav>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {menuOpen && (
          <nav className="md:hidden border-t border-gray-200 bg-white px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMenuOpen(false)}
                className={`block px-3 py-2 rounded-md text-sm font-medium ${
                  isActive(link.to) ? 'text-gray-900 bg-gray-100' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-gray-900">Cap or Not</span>
            </Link>
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-500">
              <Link to="/check" className="hover:text-gray-900 transition-colors">Check</Link>
              <Link to="/how-it-works" className="hover:text-gray-900 transition-colors">How It Works</Link>
              <Link to="/is-this-job-legit" className="hover:text-gray-900 transition-colors">Is This Job Legit?</Link>
              <Link to="/is-this-internship-legit" className="hover:text-gray-900 transition-colors">Is This Internship Legit?</Link>
              <Link to="/is-this-recruiter-legit" className="hover:text-gray-900 transition-colors">Is This Recruiter Legit?</Link>
              <Link to="/fake-internship-signs" className="hover:text-gray-900 transition-colors">Fake Internship Signs</Link>
              <Link to="/job-scam-checker" className="hover:text-gray-900 transition-colors">Job Scam Checker</Link>
            </nav>
          </div>
          <p className="mt-6 text-xs text-gray-400 text-center max-w-2xl mx-auto">
            Cap or Not calls out red flags, it doesn't hand out verdicts. It does not guarantee that an opportunity is legitimate or fraudulent. Always verify through official channels.
          </p>
        </div>
      </footer>
    </div>
  );
}