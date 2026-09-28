import fr from '../locales/fr.json';
import PosterHeader from '../components/brand/PosterHeader';
import { Card } from '../components/ui';
import yulmixLogo from '../assets/YULmix_App.png';

const AboutView = () => (
  <div className="space-y-6">
    <PosterHeader title={fr.aboutPageTitle} compact />

    <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
      <Card className="flex flex-col gap-5 p-6 sm:p-8">
        <img src={yulmixLogo} alt={fr.aboutYulmixTitle} className="h-16 w-auto self-start" />
        <p className="whitespace-pre-line text-muted">{fr.aboutYulmixContent}</p>
        <a href="https://www.mixcloud.com/yulmix/" target="_blank" rel="noopener noreferrer" className="font-semibold text-neon underline underline-offset-4">
          {fr.listenToYulmixOnMixcloud}
        </a>
        <iframe
          title={fr.mixcloudPlayerTitle}
          className="mt-auto w-full rounded-control"
          height="60"
          src="https://player-widget.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&feed=%2Fyulmix%2F"
          frameBorder="0"
          loading="lazy"
          allow="encrypted-media; fullscreen; autoplay; idle-detection; speaker-selection; web-share;"
        />
      </Card>

      <Card className="overflow-hidden">
        <img src="/bedaine-mural.webp" alt={fr.aboutMuralAlt} className="h-56 w-full object-cover sm:h-72" loading="lazy" />
        <div className="p-6 sm:p-8">
          <h2 className="font-display text-display-md text-ink">{fr.aboutLaBedaineTitle}</h2>
          <p className="mt-4 whitespace-pre-line text-muted">{fr.aboutLaBedaineContent}</p>
        </div>
      </Card>
    </div>

    <Card className="p-6 sm:p-8">
      <h2 className="text-lg font-semibold text-ink">{fr.ourCommitmentTitle}</h2>
      <p className="mt-3 max-w-prose text-muted">{fr.ourCommitmentContent}</p>
    </Card>
  </div>
);

export default AboutView;
