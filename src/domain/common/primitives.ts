/** Stable UUID-style identifier. Format validation belongs at the input boundary. */
export type EntityId = string;
/** Absolute UTC ISO 8601 timestamp, serialized with a Z suffix; never local wall time. */
export type ISODateTime = string;
/** ISO currency code. Default to KRW when creating a transaction; allow future codes. */
export type CurrencyCode = string;
export type InputMethod = 'MANUAL' | 'VOICE' | 'TEXT';
/** IANA timezone identifier, retained separately from UTC timestamps. */
export type Timezone = string;
/** Calendar date YYYY-MM-DD in the owning record's timezone; not an instant. */
export type LocalDate = string;
/** Friends see only PUBLIC events and tasks. Guest records stay PRIVATE. */
export type Visibility = 'PUBLIC' | 'PRIVATE';
