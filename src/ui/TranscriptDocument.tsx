import calleIcon from '../assets/brands/call-e/icon-yellow-256.png';

/**
 * The documentary transcript presentation, extracted from Acquisition so the Guided
 * Walkthrough can reuse the exact same language instead of imitating it. Pure
 * presentation: no lifecycle, no provider state, no network. Acquisition's rendered
 * markup is unchanged — the only addition is an optional speaker-label override, which
 * the walkthrough uses to mark its simulated caller unmistakably.
 */

export type DocumentaryTurn = Readonly<{
  offsetSeconds: number | null;
  speaker: 'bot' | 'user' | 'unknown';
  text: string;
}>;
export type SpeakerName = (speaker: DocumentaryTurn['speaker']) => string;

export const transcriptOffset = (seconds: number | null) => seconds === null
  ? 'Time unavailable'
  : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

export const speakerLabel: SpeakerName = (speaker) => speaker === 'bot' ? 'CALL-E' : speaker === 'user' ? 'Recipient' : 'Unknown speaker';

type IndexedTurn = Readonly<{ turn: DocumentaryTurn; index: number }>;
export type TurnGroup = Readonly<{ speaker: DocumentaryTurn['speaker']; items: readonly IndexedTurn[] }>;

/**
 * Visual grouping only: adjacent raw turns from the same speaker are rendered as one
 * documentary block. Every raw turn stays independently present, in order — nothing is
 * merged, rewritten, reordered or fabricated. See renderTurnGroup.
 */
export const groupBySpeaker = (items: readonly IndexedTurn[]): readonly TurnGroup[] => {
  const groups: TurnGroup[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last !== undefined && last.speaker === item.turn.speaker) { (last.items as IndexedTurn[]).push(item); continue; }
    groups.push({ speaker: item.turn.speaker, items: [item] });
  }
  return groups;
};

/** One temporal system: every raw turn carries its own inline timestamp, subordinate to speaker and text. */
export const renderTurnGroup = (group: TurnGroup, keyPrefix: string, name: SpeakerName = speakerLabel) => {
  const first = group.items[0]!;
  return <li key={`${keyPrefix}-${first.index}`} className={`is-${group.speaker}`}>
    <div className="acq-turn-head">
      <span className={`acq-speaker is-${group.speaker}`} aria-hidden="true">{group.speaker === 'bot' ? <img src={calleIcon} alt="" width="10" height="11" /> : null}</span>
      <strong>{name(group.speaker)}</strong>
    </div>
    {group.items.map((item) => <p key={`${keyPrefix}-${item.index}`}><time>{transcriptOffset(item.turn.offsetSeconds)}</time><span className="acq-turn-text">{item.turn.text}</span></p>)}
  </li>;
};

/** The whole ordered transcript as one documentary list. */
export const TranscriptDocument = ({ turns, keyPrefix, name, continued = false }: Readonly<{
  turns: readonly DocumentaryTurn[]; keyPrefix: string; name?: SpeakerName; continued?: boolean;
}>) => (
  <ol className={`transcript-timeline${continued ? ' is-continued' : ''}`}>
    {groupBySpeaker(turns.map((turn, index) => ({ turn, index }))).map((group) => renderTurnGroup(group, keyPrefix, name))}
  </ol>
);
