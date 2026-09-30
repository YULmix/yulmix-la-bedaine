import { Check } from 'lucide-react';
import fr from '../../locales/fr.json';
import { getEventTimeline } from '../../lib/eventPhase';
import { formatShortDate } from '../../lib/format';
import { cx } from '../ui';

const STEP_LABELS = {
  intent: 'phaseIntent',
  registration: 'phaseRegistration',
  payment: 'phasePayment',
  weekend: 'phaseWeekend'
};

// Where the yearly cycle is: intentions, registration, payments due, the weekend. Replaces the
// raw "months before / weeks before" tunables members used to see.
const PhaseTrack = ({ event, className }) => {
  const { steps, currentId } = getEventTimeline(event);
  if (!steps.length) return null;
  const currentIndex = currentId === 'done' ? steps.length : steps.findIndex(step => step.id === currentId);

  return (
    <nav aria-label={fr.phaseTrackLabel} className={className}>
      <ol className="grid grid-cols-4 gap-2">
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isDone = index < currentIndex;
          return (
            <li key={step.id} aria-current={isCurrent ? 'step' : undefined} className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cx(
                    'grid size-5 shrink-0 place-items-center rounded-full border-2',
                    isCurrent && 'border-neon bg-neon',
                    isDone && 'border-muted bg-muted',
                    !isCurrent && !isDone && 'border-edge'
                  )}
                >
                  {isDone && <Check className="size-3 text-night" strokeWidth={3} />}
                </span>
                <span className={cx('h-0.5 flex-1 rounded-full', index === steps.length - 1 ? 'invisible' : isDone ? 'bg-muted' : 'bg-line')} />
              </div>
              <p className={cx('mt-2 text-sm font-semibold leading-tight', isCurrent ? 'text-neon' : isDone ? 'text-muted' : 'text-faint')}>
                {fr[STEP_LABELS[step.id]]}
              </p>
              <p className="mt-0.5 font-data text-xs text-faint">
                {step.date ? formatShortDate(step.date) : fr.phaseDateTbd}
                {step.date && step.time && <span className="block">{step.time}</span>}
              </p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default PhaseTrack;
