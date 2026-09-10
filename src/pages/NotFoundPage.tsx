import { Link } from 'react-router-dom';
import { FileText, ArrowRight } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
        <FileText className="w-8 h-8 text-gray-400" />
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">That's a cap — page not found</h1>
      <p className="text-gray-500 mb-6">The page you're looking for doesn't exist or has moved.</p>
      <Link
        to="/"
        className="inline-flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white font-semibold px-5 py-2.5 rounded-lg transition-colors"
      >
        Back to home
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
