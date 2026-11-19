/**
 * Voz y registro automático (sistema `voz`). Se exporta solo lo que usan la app y las pruebas, con nombres
 * propios del sistema para no chocar con otros módulos.
 */
export { inferMission, type MissionHistoryItem, type MissionInference } from './infer';
export {
  buildVoiceContext,
  cleanTitle as cleanVoiceTitle,
  matchMission as matchVoiceMission,
  parseDictation,
  splitClauses as splitDictation,
  type DictationResult,
  type VoiceChannel,
  type VoiceContext,
  type VoiceMission,
  type VoicePerson,
  type VoiceProposal,
} from './parse';
export { parseSpanishNumber } from './text';
