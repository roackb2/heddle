import type { I18nMessageKey } from '@web/i18n';
import { useI18n } from '@web/i18n';
import { cn } from '@web/lib/utils';
import type { FileMentionSuggestion } from './useFileMentionAutocomplete';

const fileMentionI18n = {
  listboxLabel: 'composer.fileMentions.listboxLabel' as I18nMessageKey,
  title: 'composer.fileMentions.title' as I18nMessageKey,
  searching: 'composer.fileMentions.searching' as I18nMessageKey,
  unavailable: 'composer.fileMentions.unavailable' as I18nMessageKey,
  searchingWorkspace: 'composer.fileMentions.searchingWorkspace' as I18nMessageKey,
  empty: 'composer.fileMentions.empty' as I18nMessageKey,
  match: 'composer.fileMentions.match' as I18nMessageKey,
  matches: 'composer.fileMentions.matches' as I18nMessageKey,
} as const;

export type FileMentionMenuProps = {
  id: string;
  optionIdPrefix: string;
  loading: boolean;
  suggestions: FileMentionSuggestion[];
  activeIndex: number;
  error?: string;
  query: string;
  onPick: (suggestion: FileMentionSuggestion) => void;
};

export function FileMentionMenu({
  id,
  optionIdPrefix,
  loading,
  suggestions,
  activeIndex,
  error,
  query,
  onPick,
}: FileMentionMenuProps) {
  const { t } = useI18n();

  return (
    <div
      id={id}
      className="v2-file-mention-menu"
      role="listbox"
      aria-label={t(fileMentionI18n.listboxLabel)}
    >
      <div className="v2-file-mention-header">
        <span className="v2-file-mention-title">
          {t(fileMentionI18n.title)}
        </span>
        <span className="v2-file-mention-count">
          {loading ? t(fileMentionI18n.searching) : formatMatchCount(t, suggestions.length)}
        </span>
      </div>
      {error ?
        <p className="v2-file-mention-empty">
          {t(fileMentionI18n.unavailable)}
        </p>
      : suggestions.length ?
        suggestions.map((suggestion, index) => (
          <button
            key={suggestion.path}
            id={`${optionIdPrefix}-${index}`}
            className={cn(
              'v2-file-mention-option',
              index === activeIndex && 'v2-file-mention-option-active',
            )}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(suggestion);
            }}
          >
            <span className="v2-file-mention-path">@{suggestion.path}</span>
          </button>
        ))
      : <p className="v2-file-mention-empty">
          {loading ? t(fileMentionI18n.searchingWorkspace) : t(fileMentionI18n.empty)}
          {!loading && query ? <span className="v2-file-mention-query"> {query}</span> : null}
        </p>}
    </div>
  );
}

function formatMatchCount(t: (key: I18nMessageKey) => string, count: number) {
  if (count === 1) {
    return `1 ${t(fileMentionI18n.match)}`;
  }

  return `${count} ${t(fileMentionI18n.matches)}`;
}
