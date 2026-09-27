import { useNavigate } from 'react-router-dom';
import fr from '../locales/fr.json';

const AboutView = () => {
  const navigate = useNavigate();

  const handleBackToHome = () => {
    navigate('/');
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-8 text-white">
        <h1 className="text-3xl font-bold mb-2">{fr.aboutPageTitle}</h1>
      </div>

      {/* Main content - two columns for desktop, stacked for mobile */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-lg shadow-slate-950/30 p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* YULMix section */}
          <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-6">
            <div className="inline-block px-4 py-2 bg-blue-950/30 border border-blue-800/30 rounded-full mb-4">
              <h2 className="text-xl font-semibold text-slate-100">{fr.aboutYulmixTitle}</h2>
            </div>
            <div className="mt-4">
              <p className="mb-4 text-slate-300 leading-relaxed whitespace-pre-line">
                {fr.aboutYulmixContent}
               </p>
               <p className="mb-4">
                <a href="https://www.mixcloud.com/yulmix/" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300 transition-colors">{fr.listenToYulmixOnMixcloud}</a>
              </p>
              <iframe width="100%" height="60" src="https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&light=1&feed=%2Fyulmix%2F&utm_medium=share&utm_source=embed&utm_content=profile&utm_term=VXNlcjoxNzM5NTI3OQ%3D%3D" frameBorder="0" allow="encrypted-media; fullscreen; autoplay; idle-detection; speaker-selection; web-share;" ></iframe>
            </div>
          </div>

          {/* La Bédaine section */}
          <div className="bg-slate-800/30 border border-slate-700 rounded-lg p-6">
            <div className="inline-block px-4 py-2 bg-emerald-950/30 border border-emerald-800/30 rounded-full mb-4">
              <h2 className="text-xl font-semibold text-slate-100">{fr.aboutLaBedaineTitle}</h2>
            </div>
            <div className="mt-4 mb-4">
              <p className="text-slate-300 leading-relaxed whitespace-pre-line">
                {fr.aboutLaBedaineContent}
              </p>
            </div>
            <div class="h-64 w-full overflow-hidden rounded-xl">
              <img src="/banniere_bedaine.jpg" alt={fr.aboutLaBedaineTitle} class="h-full w-full object-cover object-center"/>
            </div>
          </div>
        </div>

        {/* Additional info */}
        <div className="mt-8 pt-8 border-t border-slate-700">
          <div className="bg-slate-800/20 rounded-lg p-6 border border-slate-700/50">
            <h3 className="text-lg font-semibold text-slate-200 mb-4">{fr.ourCommitmentTitle}</h3>
            <p className="text-slate-300 leading-relaxed">
              {fr.ourCommitmentContent}
              
            </p>
          </div>
        </div>

        {/* Back button */}
        <div className="mt-8 pt-6 border-t border-slate-700 flex justify-end">
          <button
            onClick={handleBackToHome}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors duration-200"
          >
            {fr.backToHome}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AboutView;