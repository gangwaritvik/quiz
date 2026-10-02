import { Logo } from '@/components/brand/logo';

const PILLARS = [
  {
    title: 'Server-authoritative exams',
    description: 'Questions, timing and grading are decided on the server, never in the browser.',
  },
  {
    title: 'Transparent integrity reports',
    description:
      'Every signal is shown to your faculty as context for review — never as a verdict.',
  },
  {
    title: 'Passwordless sign-in',
    description: 'A one-time code sent to your college address. No password to forget or share.',
  },
];

/**
 * The identity half of the login screen, set like the front matter of a
 * college prospectus: a serif statement and three numbered principles on a
 * dark Oxford ground. Hidden on small screens.
 *
 * Colours are the fixed `navy` ramp, not theme tokens, because this panel is
 * dark in both themes.
 */
export function LoginShowcase() {
  return (
    <aside className="hidden flex-col justify-between gap-10 bg-navy-950 px-12 py-10 text-navy-100 lg:flex xl:px-16 [@media(max-height:800px)]:gap-6 [@media(max-height:800px)]:py-7">
      <Logo tone="light" size="md" />

      <div className="max-w-lg">
        <p className="type-eyebrow text-navy-300">College examination platform</p>
        <h2 className="mt-4 font-serif text-4xl font-semibold leading-[1.15] text-navy-50 xl:text-[2.75rem] xl:leading-[1.12] [@media(max-height:800px)]:text-4xl">
          Your paper, your clock, a fair record.
        </h2>
        <p className="mt-5 max-w-md text-base leading-relaxed text-navy-200">
          Timers run on the server, answers save as you type, and anything flagged is reviewed by
          a person before it counts.
        </p>

        <ol className="mt-10 border-t border-navy-800 [@media(max-height:800px)]:mt-6">
          {PILLARS.map((pillar, index) => (
            <li key={pillar.title} className="flex gap-5 border-b border-navy-800 py-4 [@media(max-height:800px)]:py-3">
              <span
                aria-hidden
                className="tabular w-6 shrink-0 pt-px font-serif text-base text-navy-400"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-navy-50">{pillar.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-navy-300 [@media(max-height:800px)]:hidden">{pillar.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-xs text-navy-300">
        Protected by device-bound sessions, one-time codes and full audit logging.
      </p>
    </aside>
  );
}
