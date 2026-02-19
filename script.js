const AVAILABLE_DECKS = [
    { id: 'test', name: 'Test Deck', file: 'decks/test.txt' },
    { id: 'basic', name: 'Basic Treble Clef', file: 'decks/basic.txt' },
    { id: 'advanced', name: 'Advanced Treble Clef', file: 'decks/advanced.txt' },
    { id: 'bass', name: 'Basic Bass Clef', file: 'decks/bass.txt' }
];

let osmd;
let audioContext;
let currentDeck = null;
let currentNote = null; // object { raw: 'C#4', step: 'C', alter: 1, octave: 4 }
let currentAccidental = ''; // '', '#', 'b'
let score = 0;
let totalAttempts = 0;
let timerInterval = null;
let timeLimit = 0; // seconds
let timeLeft = 0;

// Helper to get element
const $ = (id) => document.getElementById(id);

// Init
document.addEventListener('DOMContentLoaded', async () => {
    // Setup OSMD
    osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay("osmd-canvas", {
        autoResize: true,
        backend: "svg",
        drawingParameters: "compacttight", // render as compact as possible
        drawTitle: false,
        drawPartNames: false,
    });

    // Populate Deck Select
    const deckSelect = $('deck-select');
    AVAILABLE_DECKS.forEach(deck => {
        const option = document.createElement('option');
        option.value = deck.id;
        option.textContent = deck.name;
        deckSelect.appendChild(option);
    });

    // Set default to "Basic Treble Clef"
    deckSelect.value = 'basic';

    // Load initial deck
    await loadDeckFromId(deckSelect.value);

    // Event Listeners
    deckSelect.addEventListener('change', (e) => {
        e.target.blur(); // Remove focus so keyboard shortcuts work immediately
        score = 0;
        totalAttempts = 0;
        updateScore();
        loadDeckFromId(e.target.value);
    });

    $('timer-select').addEventListener('change', (e) => {
        e.target.blur(); // Remove focus so keyboard shortcuts work immediately
        timeLimit = parseInt(e.target.value);
        nextFlashcard(); // Restart with new timer logic
    });

    $('reset-score').addEventListener('click', () => {
        score = 0;
        totalAttempts = 0;
        updateScore();
        nextFlashcard();
    });

    // Accidental Toggle
    document.querySelectorAll('.accidental-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setAccidental(btn.dataset.accidental);
        });
    });

    // Note Input
    document.querySelectorAll('.note-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            submitAnswer(btn.dataset.note);
        });
    });

    // Keyboard Input
    document.addEventListener('keydown', (e) => {
        const key = e.key.toUpperCase();
        if ("ABCDEFG".includes(key)) {
            submitAnswer(key);
        } else if (key === '#' || key === '3' && e.shiftKey) { // rough check for #
            setAccidental('#');
        } else if (key === 'B' && e.ctrlKey) { // conflict B is note. strict mapping needed.
            // B is a note. Flat usually mapped to maybe 'Minus' or 'Down'?
            // Let's rely on UI for accidentals primarily or specialized keys.
        } else if (e.key === 'ArrowUp') {
            setAccidental('#');
        } else if (e.key === 'ArrowDown') {
            setAccidental('b');
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            setAccidental('');
        }
    });

    // Audio Context unlock
    document.body.addEventListener('click', () => {
        if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') audioContext.resume();
    }, { once: true });
});

function setAccidental(val) {
    currentAccidental = val;
    document.querySelectorAll('.accidental-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.accidental === val);
    });
}


async function loadDeckFromId(id) {
    const deckInfo = AVAILABLE_DECKS.find(d => d.id === id);
    if (!deckInfo) return;

    try {
        // Append timestamp to key to avoid caching issues when deck files are edited
        const response = await fetch(deckInfo.file + '?t=' + Date.now());
        if (!response.ok) throw new Error("Failed to load deck file");
        const text = await response.text();
        currentDeck = parseDeck(text);
        currentDeck.id = id;
        console.log(`Loaded deck ${id}:`, currentDeck.notes); // Debug log
        nextFlashcard();
    } catch (e) {
        console.error(e);
        $('feedback').textContent = "Error loading deck. Ensure local server is running.";
        $('feedback').className = "feedback incorrect";
    }
}

function parseDeck(text) {
    const lines = text.split('\n');
    const deck = { notes: [] };

    lines.forEach(line => {
        const [key, ...rest] = line.split(':');
        if (!key) return;
        const val = rest.join(':').trim();

        if (key.trim().toLowerCase() === 'clef') deck.clef = val.toLowerCase();
        if (key.trim().toLowerCase() === 'notes') {
            deck.notes = val.split(',').map(n => n.trim()).filter(n => n.length > 0);

        }
    });
    return deck;
}

function updateScore() {
    $('score').textContent = `${score} out of ${totalAttempts}`;
}

function nextFlashcard() {
    if (!currentDeck || !currentDeck.notes.length) return;

    // Reset state
    $('feedback').textContent = '';
    setAccidental('');
    clearInterval(timerInterval);

    // Pick random note
    const noteStr = currentDeck.notes[Math.floor(Math.random() * currentDeck.notes.length)];
    currentNote = parseNote(noteStr);

    // Render
    renderNote(currentNote, currentDeck.clef);

    // Play sound (short delay to ensure context/rendering)
    // Removed automatic playback: setTimeout(() => playTone(currentNote), 500);

    // Timer
    if (timeLimit > 0) {
        timeLeft = timeLimit;
        $('timer-display').textContent = timeLeft + "s";
        timerInterval = setInterval(() => {
            timeLeft--;
            $('timer-display').textContent = timeLeft + "s";
            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                handleTimeout();
            }
        }, 1000);
    } else {
        $('timer-display').textContent = "";
    }
}

function parseNote(noteStr) {
    // Regex to parse C#4, Db4, C4
    const match = noteStr.match(/^([A-G])([#b])?(\d)$/);
    if (!match) return null; // fallback

    const step = match[1];
    const accidental = match[2] || '';
    const octave = match[3];

    let alter = 0;
    if (accidental === '#') alter = 1;
    if (accidental === 'b') alter = -1;

    return { raw: noteStr, step, accidental, alter, octave };
}

function renderNote(note, clefType) {
    // clefType: 'treble' | 'bass'
    // Map to Sign/Line
    let sign = 'G';
    let line = 2;
    if (clefType === 'bass') {
        sign = 'F';
        line = 4;
    }

    // Force middle alignment mechanism if possible, but mostly CSS handling
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Music</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>${sign}</sign><line>${line}</line></clef>
      </attributes>
      <note>
        <pitch>
          <step>${note.step}</step>
          <alter>${note.alter}</alter>
          <octave>${note.octave}</octave>
        </pitch>
        <duration>4</duration>
        <type>whole</type>
      </note>
    </measure>
  </part>
</score-partwise>`;

    osmd.load(xml).then(() => {
        osmd.render();
    });
}

function playTone(note) {
    if (!audioContext) return;

    // Calculate frequency
    // A4 = 440Hz.
    // MIDI number: C4 = 60. A4 = 69.
    const noteMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
    let semitones = noteMap[note.step];
    if (note.accidental === '#') semitones += 1;
    if (note.accidental === 'b') semitones -= 1;

    const octaveOffset = (parseInt(note.octave) + 1) * 12; // MIDI note calculation
    const midi = semitones + octaveOffset;

    const frequency = 440 * Math.pow(2, (midi - 69) / 12);

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.value = frequency;

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start();

    // Envelope
    gain.gain.setValueAtTime(0.5, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 1.5);

    osc.stop(audioContext.currentTime + 1.5);
}

function playErrorTone() {
    if (!audioContext) return;

    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start();

    gain.gain.setValueAtTime(0.5, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);

    osc.stop(audioContext.currentTime + 0.3);
}

function submitAnswer(noteLetter) {
    if (!currentNote) return;

    const constructedNote = noteLetter + currentAccidental;
    const target = currentNote.step + (currentNote.accidental || '');

    totalAttempts++;

    if (constructedNote === target) {
        // Correct
        score++;
        updateScore();
        $('feedback').textContent = "Correct! " + target;
        $('feedback').className = "feedback correct";

        // Play correct sound
        playTone(currentNote);

        // Wait then next
        setTimeout(nextFlashcard, 1000);
    } else {
        // Incorrect
        updateScore();
        $('feedback').textContent = `Incorrect! It was ${target}`;
        $('feedback').className = "feedback incorrect";

        // Play error sound
        playErrorTone();

        setTimeout(nextFlashcard, 1500);
    }
}

function handleTimeout() {
    totalAttempts++;
    updateScore();
    $('feedback').textContent = `Time's up! It was ${currentNote.step + (currentNote.accidental || '')}`;
    $('feedback').className = "feedback incorrect";
    setTimeout(nextFlashcard, 1500);
}
