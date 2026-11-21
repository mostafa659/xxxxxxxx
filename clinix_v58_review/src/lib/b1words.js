/* More everyday English (CEFR A2 – B1) for the "new words" filter (v3.27).
   commonwords.js + basicwords.js missed many plain words, and a word that is in none of the lists used to pass whatever the AI said about it
   (the AI often tags a B1 word "[B2]"). Everything here is a word a B1 learner already knows, taken from the Oxford 3000 at A2 / B1
   or so common in nursing exam stems that nobody needs it explained ("temperature", "pressure", "symptom" …).
   Rules: base forms only (the stemmer in parse.js handles -s -ed -ing -ly -er); nothing here is B2 or higher. The plain body / health words
   every nursing student knows (heart, fever, kidney, pain …) are in; specialised terms (edema, dyspnea, infection, contraindicated …) are NOT
   and always survive. Safe to extend: add a word only if you are sure it is B1 or lower. */
const RAW = `
temperature pressure recent current proper careful quick slow normal immediate application apply review schedule encourage symptom reaction request
account achieve act active ancient author basic battle behaviour behavior blind cell central chain chapter charity classic clue comfort comment concentrate
deliver disaster discount disease display edge emergency emotion failure frighten gather illness image injury inner install intend intention
label latest leader liquid loose lower mainly medical medicine mental minor minimum mixed movement muscle negative nerve network opportunity option
organ original passage patience pattern permanent physical pill planet poison policy political pollution pool positive possibility practical praise
pregnant preparation pretend private probable profession professional progress promise protect protein purchase pure quantity rapid rare react
realise realize reality recall recognise recognize reduce refer region register religion remark remove replace resource respect responsible result
retire rhythm risk rough royal safety sample scene science scientific screen search secret section select sense separate series serious
shape share sharp shock sight signal silence similar simply single situation skill solution solve source spare speed stage standard state statement
steady stock stress strong subject succeed success suffer suggest supply support surface surgery survive switch symbol system target task technology
term theory tool tough tradition transport treat treatment trial trick tube type typical unable unusual useful valuable variety vehicle version
victim view violence virus visible vision weapon weight whisper wide willing
recommend report prevent provide include including require requirement increase avoid expect expected further likely regular regularly
usually usual recently currently properly carefully quickly slowly normally suddenly immediately finally especially mostly nearly probably
difficult dangerous worried tired serious early ready enough
accident advice agree allow already amount anxious appointment arrange attack bandage bathroom bedroom blanket bleed blood bone brain breath breathe
burn cancer cause chest cheek chest chin cough cream cure dental dentist diet doctor dose drug elbow exercise faint fever finger fit flu foot forehead
gum hand hang headache health healthy heart heat height hip hurt illness injure injection joint kidney knee lung medicine mouth neck nose nurse operation
pain patient pharmacy pill pulse rest rib shoulder sick skin sleep smoke sore stomach sweat tablet throat thumb toe tongue tooth treatment vomit
waist weak weigh wrist
`;
export const B1_EXTRA = new Set(RAW.toLowerCase().split(/\s+/).filter(Boolean));
