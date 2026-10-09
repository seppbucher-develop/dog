import type { Card, Move, RuleSettings } from '@dog/engine';

/** Anzeigetext der Karte (Schweizer Bezeichnungen: Bube, Dame, König, Ass) */
export const CARD_TEXT: Record<Card, string> = {
  A: 'A', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9', '10': '10',
  J: 'B', Q: 'D', K: 'K', JOKER: '★',
};

export function cardHint(card: Card, teams: boolean, fourBoth = false): string {
  switch (card) {
    case 'A': return 'Raus · 1 · 11';
    case 'K': return 'Raus · 13';
    case 'Q': return '12 Felder';
    case 'J': return 'Kugeln tauschen';
    case '2': return teams ? '2 Felder' : '2 Felder · Karte ziehen';
    case 'JOKER': return 'jede Karte';
    case '4': return fourBoth ? '4 vor · zurück' : '4 rückwärts';
    case '7': return 'aufteilbar';
    default: return `${card} Felder`;
  }
}

export function moveText(m: Move, names: string[]): string {
  switch (m.t) {
    case 'start': return 'kommt heraus';
    case 'move': return m.steps < 0 ? `zieht ${-m.steps} zurück` : `zieht ${m.steps} vor${m.pass ? ' (am Haus vorbei)' : ''}`;
    case 'swap': return 'tauscht zwei Kugeln';
    case 'steal': return `zieht eine Karte von ${names[m.from] ?? '?'}`;
  }
}

export interface RuleField {
  key: keyof RuleSettings;
  label: string;
  hint?: string;
  kind: 'select' | 'bool' | 'sizes';
  options?: [string, string][];
}

export const RULE_FIELDS: RuleField[] = [
  {
    key: 'firstPegOnStart', label: 'Erste Kugel schon auf dem Startfeld', kind: 'select',
    options: [['auto', 'Automatisch (bei 2, 3, 5 Spielern)'], ['on', 'Immer'], ['off', 'Nie']],
  },
  {
    key: 'cardExchange', label: 'Kartentausch zu Rundenbeginn', kind: 'select',
    hint: 'Team: mit dem Partner tauschen; sonst blind vom rechten Nachbarn ziehen', options: [['auto', 'Ja'], ['off', 'Nein']],
  },
  { key: 'captureOwn', label: 'Eigene und Team-Kugeln dürfen geschlagen werden', kind: 'bool' },
  { key: 'jackSwapPartner', label: 'Bube: Tausch mit Kugeln des Partners', hint: 'nur Teamspiel', kind: 'bool' },
  { key: 'jackSwapOwn', label: 'Bube: Tausch zweier eigener Kugeln', hint: 'verhindert Abwurf der Hand', kind: 'bool' },
  { key: 'playForAllPartners', label: 'Fertig: für alle Partner ziehen', hint: 'sonst nur für den nächsten unfertigen Partner (Teams zu 3)', kind: 'bool' },
  { key: 'sevenRepeatPeg', label: '7: dieselbe Kugel mehrfach aufteilen', hint: 'kaum spürbar', kind: 'bool' },
  {
    key: 'sevenAnyPeg', label: '7: auf alle Kugeln aufteilbar', hint: 'sonst nur eigene (und die des Partners, wenn man fertig ist)', kind: 'select',
    options: [['auto', 'Automatisch (bei 2, 3, 5 Spielern)'], ['on', 'Immer'], ['off', 'Nie']],
  },
  {
    key: 'fourDirection', label: '4 spielen', kind: 'select',
    options: [['both', 'Vorwärts oder rückwärts'], ['backward', 'Nur rückwärts']],
  },
  {
    key: 'twoPlayerBoard', label: 'Brett bei 2 Spielern (4 Kugeln)', kind: 'select',
    options: [['compact', 'Klein (2 Abschnitte)'], ['full', 'Groß (4 Abschnitte)']],
  },
  {
    key: 'sixPlayerTeams', label: 'Teams bei 6 Spielern', kind: 'select',
    options: [['threeOfTwo', '3 Teams zu 2 (Partner gegenüber)'], ['twoOfThree', '2 Teams zu 3']],
  },
  {
    key: 'turnSpeed', label: 'Zuggeschwindigkeit', hint: '1 = schnell, 5 = langsam', kind: 'select',
    options: [['1', '1 – schnell'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 – langsam']],
  },
  { key: 'handSizes', label: 'Karten pro Runde', hint: 'kommagetrennt, wird wiederholt', kind: 'sizes' },
];

export const LEVEL_LABEL: Record<string, string> = {
  beginner: 'Anfänger', intermediate: 'Mittel', advanced: 'Fortgeschritten', expert: 'Experte',
};
