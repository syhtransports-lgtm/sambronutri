// ===== SAMBRO NUTRI — APP.JS =====
// Firebase + AI (Gemini/Groq via Netlify proxy) Integration

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, collection,
  addDoc, getDocs, deleteDoc, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCEkQpwwFppAd3RTodWLRSkbyoEVKGSdNs",
  authDomain: "sambronutri.firebaseapp.com",
  projectId: "sambronutri",
  storageBucket: "sambronutri.firebasestorage.app",
  messagingSenderId: "136065562467",
  appId: "1:136065562467:web:506e016167036c6a9d4556"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// AI API — routed via Netlify serverless proxy
const AI_API = "/.netlify/functions/claude-proxy";

// ===== STATE =====
let currentUser = null;
let userProfile = {};
let journalDate = new Date();
let lastCalResult = null;
let weightHistory = [];
let chatHistory = [];
let waterCount = 0;
let journalMealsCache = {}; // For weekly charts and stats

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("auth-overlay").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    await loadUserProfile();
    await loadDailyData();
    initApp();
  } else {
    currentUser = null;
    document.getElementById("auth-overlay").classList.remove("hidden");
    document.getElementById("app").classList.add("hidden");
  }
});

// ===== AUTH FUNCTIONS =====
window.showAuthTab = function(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
  event.target.classList.add('active');
  document.getElementById(`${tab}-form`).classList.remove('hidden');
  clearAuthError();
};

window.loginUser = async function() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  if (!email || !password) return showAuthError("Veuillez remplir tous les champs.");
  try { await signInWithEmailAndPassword(auth, email, password); } 
  catch (e) { showAuthError(getFirebaseError(e.code)); }
};

window.loginGoogle = async function() {
  try { await signInWithPopup(auth, googleProvider); } 
  catch (e) { showAuthError("Erreur de connexion Google."); }
};

window.registerUser = async function() {
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const age = document.getElementById('reg-age').value;
  const gender = document.getElementById('reg-gender').value;
  const weight = document.getElementById('reg-weight').value;
  const height = document.getElementById('reg-height').value;

  if (!name || !email || !password) return showAuthError("Veuillez remplir les champs obligatoires.");
  if (password.length < 6) return showAuthError("Mot de passe trop court.");

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const profile = { name, email, age: +age||0, gender, weight: +weight||0, height: +height||0, calGoal: 2000, weightGoal: 0, createdAt: new Date().toISOString() };
    await setDoc(doc(db, "users", cred.user.uid), profile);
    userProfile = profile;
  } catch (e) { showAuthError(getFirebaseError(e.code)); }
};

window.logoutUser = async function() { await signOut(auth); };

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.classList.remove('hidden');
}
function clearAuthError() { document.getElementById('auth-error').classList.add('hidden'); }
function getFirebaseError(code) {
  const map = {
    'auth/user-not-found': 'Aucun compte avec cet email.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/email-already-in-use': 'Cet email est déjà utilisé.',
    'auth/invalid-email': 'Email invalide.',
    'auth/invalid-credential': 'Email ou mot de passe incorrect.',
  };
  return map[code] || 'Une erreur est survenue. Réessayez.';
}

// ===== PROFILE =====
async function loadUserProfile() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (snap.exists()) { userProfile = snap.data(); } 
    else {
      userProfile = { name: currentUser.displayName || currentUser.email.split('@')[0], email: currentUser.email, calGoal: 2000, weightGoal: 0 };
      await setDoc(doc(db, "users", currentUser.uid), userProfile);
    }
  } catch (e) { console.error(e); }
}

async function saveProfileToFirebase() {
  try { await setDoc(doc(db, "users", currentUser.uid), userProfile, { merge: true }); } 
  catch (e) { console.error(e); }
}

async function loadDailyData() {
  const dateKey = toDateKey(new Date());
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid, "dailyData", dateKey));
    if (snap.exists()) { waterCount = snap.data().water || 0; } 
    else { waterCount = 0; }
  } catch(e) { console.error(e); waterCount = 0; }
  renderWater();
}

async function saveDailyData() {
  const dateKey = toDateKey(new Date());
  try { await setDoc(doc(db, "users", currentUser.uid, "dailyData", dateKey), { water: waterCount }, { merge: true }); } 
  catch(e) { console.error(e); }
}

// ===== INIT APP =====
async function initApp() {
  updateGreeting();
  updateDateDisplay();
  setProfileUI();
  await loadJournalForWeek(); // Load last 7 days for charts
  loadJournalForDate();
  loadWeightHistory();
  setDashboardStats();
  loadDailyTip();
  calculateStreak();
  updateJournalDateLabel();
}

function updateGreeting() {
  const h = new Date().getHours();
  const name = userProfile.name || 'ami(e)';
  let greet = h < 12 ? 'Bonjour' : h < 18 ? 'Bonne après-midi' : 'Bonsoir';
  document.getElementById('greeting-text').textContent = `${greet}, ${name} 👋`;
  const avatar = name.charAt(0).toUpperCase();
  document.getElementById('user-avatar').textContent = avatar;
  document.getElementById('profile-avatar-big').textContent = avatar;
}

function updateDateDisplay() {
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('today-date').textContent = new Date().toLocaleDateString('fr-FR', opts);
}

function setProfileUI() {
  document.getElementById('profile-name').value = userProfile.name || '';
  document.getElementById('profile-email').value = userProfile.email || currentUser.email || '';
  document.getElementById('profile-age').value = userProfile.age || '';
  document.getElementById('profile-gender').value = userProfile.gender || '';
  document.getElementById('profile-weight').value = userProfile.weight || '';
  document.getElementById('profile-height').value = userProfile.height || '';
  document.getElementById('profile-cal-goal').value = userProfile.calGoal || 2000;
  document.getElementById('profile-weight-goal').value = userProfile.weightGoal || '';
}

window.saveProfile = async function() {
  userProfile.name = document.getElementById('profile-name').value;
  userProfile.age = +document.getElementById('profile-age').value;
  userProfile.gender = document.getElementById('profile-gender').value;
  userProfile.weight = +document.getElementById('profile-weight').value;
  userProfile.height = +document.getElementById('profile-height').value;
  userProfile.calGoal = +document.getElementById('profile-cal-goal').value || 2000;
  userProfile.weightGoal = +document.getElementById('profile-weight-goal').value;

  await saveProfileToFirebase();
  updateGreeting(); setDashboardStats();
  showToast("Profil sauvegardé ✓");
};

// ===== PAGE NAV =====
window.showPage = function(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  const navItem = document.querySelector(`[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  if (page === 'journal') loadJournalForDate();
  if (page === 'weight') renderWeightChart();
  if (page === 'dashboard') { setDashboardStats(); renderWeekChart(); }
  if (page === 'weight') { document.getElementById('ws-goal').textContent = userProfile.weightGoal ? userProfile.weightGoal + ' kg' : '–'; }
};

// ===== AI CALL =====
async function callAI(prompt, systemPrompt = "", isChat = false, messages = []) {
  const body = {};
  if (systemPrompt) body.system = systemPrompt;

  if (isChat) {
    body.messages = messages;
  } else {
    body.messages = [{ role: "user", content: prompt }];
  }

  const response = await fetch(AI_API, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Proxy error:", response.status, errText);
    throw new Error(`Proxy HTTP ${response.status}: ${errText}`);
  }
  const data = await response.json();
  if (data.error) throw new Error(data.error);

  const text = data.content?.[0]?.text || "";
  if (!text) throw new Error("Réponse vide de l'IA.");
  return text;
}

function markdownToHTML(md) {
  return md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h3>$1</h3>')
    .replace(/^\* (.*$)/gim, '<li>$1</li>')
    .replace(/^- (.*$)/gim, '<li>$1</li>')
    .replace(/<\/li>\n<li>/gim, '</li><li>')
    .replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>')
    .replace(/<ul>\s*<ul>/g, '<ul>')
    .replace(/<\/ul>\s*<\/ul>/g, '</ul>')
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    .replace(/\n\n/g, '<br><br>');
}

// ===== CALORIES =====
window.estimateCalories = async function() {
  const desc = document.getElementById('cal-input').value.trim();
  if (!desc) return showToast("Décrivez votre repas d'abord.");

  document.getElementById('cal-loading').classList.remove('hidden');
  document.getElementById('cal-result').classList.add('hidden');

  try {
    const response = await callAI(
      `Analyse ce repas et estime les calories et macronutriments. Réponds UNIQUEMENT en JSON valide, sans bloc de code markdown, format exact:\n${desc}`,
      `Tu es nutritionniste. Réponds en JSON pur (aucun markdown \`\`\`json ou texte autour):
{"total_calories": 500, "items": [{"name": "aliment", "calories": 300}], "macros": {"proteines": 30, "glucides": 50, "lipides": 15}, "note": "commentaire court"}`
    );

    const clean = response.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    lastCalResult = { description: desc, calories: data.total_calories, data };

    document.getElementById('cal-total-badge').textContent = `${data.total_calories} kcal`;
    document.getElementById('cal-breakdown').innerHTML = (data.items || []).map(item =>
      `<div class="cal-item"><span class="cal-item-name">${item.name}</span><span class="cal-item-value">${item.calories} kcal</span></div>`
    ).join('');

    const m = data.macros || { proteines: 0, glucides: 0, lipides: 0 };
    document.getElementById('cal-macros').innerHTML = `
      <div class="macro-item"><span class="macro-val">${m.proteines}g</span><span class="macro-lbl">Protéines</span></div>
      <div class="macro-item"><span class="macro-val">${m.glucides}g</span><span class="macro-lbl">Glucides</span></div>
      <div class="macro-item"><span class="macro-val">${m.lipides}g</span><span class="macro-lbl">Lipides</span></div>
    `;
    renderMacroPie(m.proteines, m.glucides, m.lipides);

    document.getElementById('cal-result').classList.remove('hidden');
    if (data.note) showToast(`💡 ${data.note}`);
  } catch (e) {
    showToast("Erreur d'analyse. Assurez-vous d'avoir configuré la clé API.");
    console.error(e);
  } finally {
    document.getElementById('cal-loading').classList.add('hidden');
  }
};

function renderMacroPie(p, g, l) {
  const canvas = document.getElementById('macro-pie-chart');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, center = w/2, radius = w/2 - 10;
  ctx.clearRect(0, 0, w, h);
  
  const total = p + g + l;
  if (total === 0) return;
  
  const colors = ['#4ade80', '#60a5fa', '#facc15']; // P, G, L
  const vals = [p, g, l];
  const labels = ['Protéines', 'Glucides', 'Lipides'];
  let currentAngle = -0.5 * Math.PI;

  for (let i = 0; i < 3; i++) {
    const angle = (vals[i] / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, currentAngle, currentAngle + angle);
    ctx.fillStyle = colors[i];
    ctx.fill();
    currentAngle += angle;
  }

  // Draw inner circle for donut
  ctx.beginPath(); ctx.arc(center, center, radius * 0.6, 0, 2*Math.PI);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--cream-2').trim();
  ctx.fill();

  // Legend
  const leg = document.getElementById('macro-legend');
  leg.innerHTML = labels.map((lb, i) => `
    <div class="legend-item"><div class="legend-color" style="background:${colors[i]}"></div>${lb} (${Math.round((vals[i]/total)*100)}%)</div>
  `).join('');
}

window.addMealToJournal = function() {
  if (!lastCalResult) return;
  // Open modal prefilled, with user selecting date & type
  openAddMeal(null, true);
};

// ===== JOURNAL & MODAL =====
function toDateKey(date) { return date.toISOString().split('T')[0]; }

function updateJournalDateLabel() {
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  document.getElementById('journal-date-label').textContent = journalDate.toLocaleDateString('fr-FR', opts);
}

window.changeJournalDate = function(delta) {
  journalDate.setDate(journalDate.getDate() + delta);
  updateJournalDateLabel(); loadJournalForDate();
};

async function loadJournalForWeek() {
  journalMealsCache = {};
  const today = new Date();
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  try {
    const q = query(
      collection(db, "users", currentUser.uid, "meals"), 
      where("date", ">=", toDateKey(weekAgo)),
      where("date", "<=", toDateKey(today))
    );
    const snap = await getDocs(q);
    snap.forEach(d => {
      const data = d.data();
      if (!journalMealsCache[data.date]) journalMealsCache[data.date] = [];
      journalMealsCache[data.date].push(data);
    });
  } catch (e) { console.error(e); }
}

async function loadJournalForDate() {
  const dateKey = toDateKey(journalDate);
  const types = { 'Petit-déjeuner': 'breakfast', 'Déjeuner': 'lunch', 'Dîner': 'dinner', 'Collation': 'snack' };
  Object.values(types).forEach(id => { document.getElementById(`meal-${id}`).innerHTML = ''; });

  try {
    const q = query(collection(db, "users", currentUser.uid, "meals"), where("date", "==", dateKey));
    const snap = await getDocs(q);
    const meals = [];
    snap.forEach(d => meals.push({ id: d.id, ...d.data() }));

    let total = 0;
    meals.forEach(meal => {
      const typeId = types[meal.type] || 'snack';
      const el = document.getElementById(`meal-${typeId}`);
      if (el) {
        const div = document.createElement('div');
        div.className = 'meal-entry';
        div.innerHTML = `<span class="meal-entry-name">${meal.description}</span><span class="meal-entry-cal">${meal.calories} kcal</span><button class="meal-delete-btn" onclick="deleteMeal('${meal.id}')" title="Supprimer">✕</button>`;
        el.appendChild(div);
      }
      total += meal.calories || 0;
    });

    document.getElementById('journal-total-cal').textContent = `${total} kcal`;
    if (dateKey === toDateKey(new Date())) setDashboardStats();
  } catch (e) { console.error(e); }
}

window.deleteMeal = async function(id) {
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "meals", id));
    loadJournalForWeek(); loadJournalForDate();
  } catch (e) { console.error(e); }
};

window.openAddMeal = function(type, fromCalc = false) {
  const dateInput = document.getElementById('modal-meal-date');
  const typeSelect = document.getElementById('modal-meal-type');
  const descInput = document.getElementById('modal-meal-desc');
  const calInput = document.getElementById('modal-meal-cal');
  
  // Set constraints for date
  const todayStr = toDateKey(new Date());
  dateInput.max = todayStr;
  
  if (fromCalc && lastCalResult) {
    document.getElementById('modal-meal-type-title').textContent = "Ajouter ce repas au journal";
    dateInput.value = todayStr;
    descInput.value = lastCalResult.description;
    calInput.value = lastCalResult.calories;
    if (type) typeSelect.value = type;
  } else {
    document.getElementById('modal-meal-type-title').textContent = type ? `Ajouter — ${type}` : "Ajouter un repas";
    dateInput.value = toDateKey(journalDate);
    if (type) typeSelect.value = type;
    descInput.value = ''; calInput.value = '';
  }
  
  document.getElementById('meal-modal').classList.remove('hidden');
};

window.closeMealModal = function() { document.getElementById('meal-modal').classList.add('hidden'); };

window.addMealEntry = async function() {
  const dateVal = document.getElementById('modal-meal-date').value;
  const type = document.getElementById('modal-meal-type').value;
  const desc = document.getElementById('modal-meal-desc').value.trim();
  const calStr = document.getElementById('modal-meal-cal').value;
  const cal = +calStr || 0;
  
  if (!dateVal) return showToast("Choisissez une date.");
  if (!desc) return showToast("Décrivez le repas.");
  
  let calories = cal;
  if (!calStr) {
    showToast("Estimation en cours...");
    try {
      const response = await callAI(`Estime les calories de: ${desc}. Réponds UNIQUEMENT le nombre entier.`, "Nutritionniste. Réponds juste un nombre.");
      calories = parseInt(response.replace(/\D/g,'')) || 300;
    } catch (e) { calories = 300; }
  }

  const meal = { description: desc, calories, type, date: dateVal, createdAt: new Date().toISOString() };
  await addDoc(collection(db, "users", currentUser.uid, "meals"), meal);
  
  closeMealModal();
  showToast(`Ajouté le ${dateVal} — ${calories} kcal ✓`);
  
  // Update UI if added to currently viewed date
  if (dateVal === toDateKey(journalDate)) loadJournalForDate();
  if (dateVal === toDateKey(new Date())) setDashboardStats();
  loadJournalForWeek(); // refresh cache
};

// ===== RECORD PDF EXPORT =====
window.exportPDF = function() {
  if (typeof html2pdf === 'undefined') return showToast("L'export PDF charge. Réessayez.");
  const el = document.getElementById('page-journal');
  const opt = { margin: 10, filename: `Journal_SambroNutri_${toDateKey(journalDate)}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
  html2pdf().set(opt).from(el).save();
};

// ===== DASHBOARD STATS & SCORE =====
async function setDashboardStats() {
  try {
    const today = toDateKey(new Date());
    const meals = journalMealsCache[today] || [];
    let total = meals.reduce((acc, m) => acc + (m.calories || 0), 0);
    const goal = userProfile.calGoal || 2000;
    const remaining = Math.max(0, goal - total);
    const pct = Math.min(100, Math.round((total / goal) * 100));

    document.getElementById('dash-cal-consumed').textContent = total;
    document.getElementById('dash-cal-goal').textContent = goal;
    document.getElementById('dash-cal-remaining').textContent = remaining;
    document.getElementById('dash-progress-pct').textContent = pct + '%';
    document.getElementById('dash-progress-bar').style.width = pct + '%';

    // Update Score
    calculateHealthScore(total, goal, waterCount);

    if (weightHistory.length > 0) document.getElementById('dash-weight').textContent = weightHistory[weightHistory.length - 1].weight + ' kg';
    else if (userProfile.weight) document.getElementById('dash-weight').textContent = userProfile.weight + ' kg';

    const dashMeals = document.getElementById('dash-meals-list');
    if (meals.length === 0) dashMeals.innerHTML = '<p class="empty-state">Aucun repas aujourd\'hui.</p>';
    else dashMeals.innerHTML = meals.slice(0, 4).map(m => `<div class="meal-entry"><span class="meal-entry-name">${m.description.substring(0,35)}...</span><span class="meal-entry-cal">${m.calories} kcal</span></div>`).join('');
  } catch (e) { console.error(e); }
}

function calculateHealthScore(calTotal, calGoal, water) {
  let score = 50; 
  if (calTotal > 0) {
    const ratio = calTotal / calGoal;
    if (ratio >= 0.8 && ratio <= 1.1) score += 30;
    else if (ratio >= 0.5 && ratio <= 1.3) score += 15;
  }
  score += Math.min(water, 8) * 2.5; // Up to 20 for water
  score = Math.floor(Math.min(100, score));
  
  document.getElementById('health-score').textContent = score;
  const circle = document.getElementById('score-circle');
  if (circle) circle.style.strokeDashoffset = 213.6 - (213.6 * score / 100);
}

// ===== WEEKLY GRAPHS =====
function renderWeekChart() {
  const canvas = document.getElementById('week-cal-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.parentElement.clientWidth - 40; canvas.width = w; canvas.height = 140;
  ctx.clearRect(0,0,w,140);
  
  const today = new Date();
  const data = [];
  const labels = [];
  for(let i=6; i>=0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = toDateKey(d);
    const total = (journalMealsCache[key] || []).reduce((acc, m) => acc + m.calories, 0);
    data.push(total);
    labels.push(d.toLocaleDateString('fr-FR', {weekday: 'short'}));
  }

  const max = Math.max(...data, userProfile.calGoal || 2000, 100);
  const plotW = w - 40, plotH = 100, padLeft = 30, padTop = 10;
  
  const barW = Math.min(plotW / 7 * 0.5, 30);
  const gap = (plotW - (barW * 7)) / 7;

  // goal line
  const goalY = padTop + plotH - (plotH * ((userProfile.calGoal||2000)/max));
  ctx.strokeStyle = '#c4956a'; ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(padLeft, goalY); ctx.lineTo(w, goalY); ctx.stroke(); ctx.setLineDash([]);
  
  data.forEach((val, i) => {
    const h = (val / max) * plotH;
    const x = padLeft + gap/2 + i*(barW + gap);
    const y = padTop + plotH - h;
    
    // Bar
    const grad = ctx.createLinearGradient(0, y, 0, y+h);
    grad.addColorStop(0, '#4d7a5e'); grad.addColorStop(1, '#81aa92');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(x, y, barW, h, [4,4,0,0]); ctx.fill();
    
    // Label
    ctx.fillStyle = '#5f6f65'; ctx.font = '11px DM Sans'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + barW/2, padTop + plotH + 18);
  });
}

// ===== WATER =====
window.setWater = function(val) {
  waterCount = val === waterCount ? val - 1 : val; // toggle
  renderWater(); saveDailyData(); setDashboardStats();
};
function renderWater() {
  const liters = (waterCount * 0.25);
  const formatted = liters % 1 === 0 ? liters : liters.toFixed(2);
  document.getElementById('water-count').textContent = formatted + ' L';
  const btns = document.querySelectorAll('.glass-btn');
  btns.forEach((b, i) => {
    if (i < waterCount) b.classList.add('active'); else b.classList.remove('active');
  });
}

// ===== STREAK =====
async function calculateStreak() {
  try {
    const q = query(collection(db, "users", currentUser.uid, "meals"), orderBy("date", "desc"));
    const snap = await getDocs(q);
    const dates = new Set();
    snap.forEach(d => dates.add(d.data().date));
    
    const arr = Array.from(dates).sort((a,b) => b.localeCompare(a));
    let s = 0;
    let checkDate = new Date();
    
    // Start check from today. if today missing, check yesterday
    if (!arr.includes(toDateKey(checkDate))) {
      checkDate.setDate(checkDate.getDate() - 1);
      if (!arr.includes(toDateKey(checkDate))) {
        updateStreakUI(0); return;
      }
    }
    
    while (arr.includes(toDateKey(checkDate))) {
      s++;
      checkDate.setDate(checkDate.getDate() - 1);
    }
    updateStreakUI(s);
  } catch(e) { console.error(e); }
}
function updateStreakUI(s) {
  document.getElementById('streak-count').textContent = s;
  document.getElementById('dash-streak').textContent = s;
}

// ===== PLAN SEMAINE =====
window.generateWeekPlan = async function() {
  const goal = document.getElementById('week-goal').value;
  const diet = document.getElementById('week-diet').value;
  
  document.getElementById('week-loading').classList.remove('hidden');
  document.getElementById('week-result').classList.add('hidden');
  
  try {
    const prompt = `Crée un plan alimentaire de 7 jours (Lundi-Dimanche). Objectif: ${goal}. Régime: ${diet || 'aucun'}. Calories journalières cibles: ${userProfile.calGoal || 2000}.
Donne une structure simple avec Petit-déjeuner, Déjeuner, Collation, Dîner pour chaque jour. Format Markdown clair et synthétique (pas de long blabla).`;
    
    const res = await callAI(prompt, "Nutritionniste expert. Réponds uniquement avec le menu en markdown structuré (### Lundi, etc).");
    document.getElementById('week-result').innerHTML = markdownToHTML(res);
    document.getElementById('week-result').classList.remove('hidden');
  } catch (e) { showToast("Erreur IA"); }
  finally { document.getElementById('week-loading').classList.add('hidden'); }
};

// ===== CHATBOT IA =====
window.sendChat = async function() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendChat('user', msg);
  
  // Format history for Groq/Gemini
  const aiMessages = chatHistory.map(m => ({ role: m.role, content: m.content }));
  aiMessages.push({ role: "user", content: msg });
  
  try {
    const reply = await callAI(msg, "Tu es le coach Sambro Nutri. Sois encourageant, bref, donne des astuces concrètes. Format markdown simple.", true, aiMessages);
    appendChat('assistant', reply);
  } catch(e) { appendChat('assistant', "Désolé, je suis fatigué. Réessayez plus tard !"); }
};
window.sendSuggestion = function(btn) {
  document.getElementById('chat-input').value = btn.innerText;
  sendChat();
};
function appendChat(role, text) {
  chatHistory.push({ role, content: text });
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  const bubble = role === 'assistant' ? `<div class="chat-avatar">🌿</div><div class="chat-bubble">${markdownToHTML(text)}</div>` 
    : `<div class="chat-bubble">${text}</div>`;
  div.innerHTML = bubble;
  document.getElementById('chat-messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

// ===== IMC =====
window.calculateIMC = function() {
  const w = +document.getElementById('imc-weight').value;
  const h = +document.getElementById('imc-height').value;
  if(!w || !h) return showToast("Saisissez poids et taille.");
  
  const m = h/100;
  const imc = w / (m*m);
  let label = "", advice = "", percent = 0;
  
  if (imc < 18.5) { label = "Maigreur"; advice = "Vous êtes en sous-poids. Pensez à augmenter vos calories de façon saine."; percent = (imc/18.5)*25; }
  else if (imc < 25) { label = "Normal"; advice = "Poids idéal ! Maintenez vos bonnes habitudes (sport et équilibre)."; percent = 25 + ((imc-18.5)/6.5)*25; }
  else if (imc < 30) { label = "Surpoids"; advice = "Un léger déficit calorique et plus d'activité physique santé vous aideront."; percent = 50 + ((imc-25)/5)*25; }
  else { label = "Obésité"; advice = "Il est recommandé de consulter un professionnel pour un suivi adapté."; percent = 75 + Math.min(((imc-30)/10)*25, 25); }
  
  document.getElementById('imc-value').textContent = imc.toFixed(1);
  document.getElementById('imc-label').textContent = label;
  document.getElementById('imc-advice').textContent = advice;
  document.getElementById('imc-indicator').style.left = `${Math.min(98, percent)}%`;
  
  document.getElementById('imc-result').classList.remove('hidden');
};

// ===== HABITS ANALYSIS =====
window.analyzeHabits = async function() {
  document.getElementById('habits-loading').classList.remove('hidden');
  document.getElementById('habits-result').classList.add('hidden');
  try {
    const pastMeals = Object.values(journalMealsCache).flat().map(m => m.description).join(', ');
    const res = await callAI(`Analyse ces repas récents et détermine mes habitudes. Donne 3 forces et 2 points à améliorer : ${pastMeals || 'aucun repas'}`, 
      "Court et pertinent format Markdown.");
    document.getElementById('habits-result').innerHTML = `<div class="card" style="margin-bottom:0">${markdownToHTML(res)}</div>`;
    document.getElementById('habits-result').classList.remove('hidden');
  } catch(e) {} document.getElementById('habits-loading').classList.add('hidden');
};

// ... ALL OTHER EXISTING FUNCTIONS (Recipes, Sport, Daily Tip, Weight History Chart) remain functionally identical ...

// Recipes Generation
window.generateRecipes = async function() {
  const ingredients = document.getElementById('recipe-ingredients').value.trim();
  const type = document.getElementById('recipe-type').value;
  const diet = document.getElementById('recipe-diet').value;
  if (!ingredients) return showToast("Entrez vos ingrédients.");

  document.getElementById('recipe-loading').classList.remove('hidden');
  document.getElementById('recipes-result').classList.add('hidden');
  
  try {
    const prompt = `Ingrédients: ${ingredients}. Type: ${type}. Régime: ${diet}. Donne 4 recettes direct en JSON.`;
    const response = await callAI(prompt, `JSON UNIQUEMENT sans \`\`\`json: {"recettes": [{"emoji":"🍗","nom":"X","temps":"15m","calories":400,"difficulte":"Facile","description":"X","ingredients":"X","etapes":"X"}]}`);
    const data = JSON.parse(response.replace(/```json|```/g, '').trim());
    document.getElementById('recipes-result').innerHTML = (data.recettes||[]).map(r => `
      <div class="recipe-card"><span class="recipe-emoji">${r.emoji||'🍽️'}</span><h3>${r.nom}</h3>
      <div class="recipe-meta"><span class="recipe-tag cal">${r.calories} kcal</span><span class="recipe-tag">${r.temps}</span><span class="recipe-tag">${r.difficulte}</span></div>
      <p class="recipe-desc">${r.description}</p><div class="recipe-ingredients"><strong>Ingrédients:</strong> ${r.ingredients}</div><div class="recipe-steps"><strong>Préparation:</strong><br/>${r.etapes}</div></div>
    `).join('');
    document.getElementById('recipes-result').classList.remove('hidden');
  } catch (e) { showToast("Erreur."); }
  finally { document.getElementById('recipe-loading').classList.add('hidden'); }
};

window.generateSportPlan = async function() {
  const level = document.getElementById('sport-level').value;
  const goal = document.getElementById('sport-goal').value;
  const equipment = document.getElementById('sport-equipment').value;
  document.getElementById('sport-loading').classList.remove('hidden');
  document.getElementById('sport-result').classList.add('hidden');
  try {
    const response = await callAI(`Niveau: ${level}, Objectif: ${goal}, Matériel: ${equipment}. JSON direct de 3 exos.`, 
      `JSON UNIQUEMENT: {"exercices":[{"emoji":"🏃","nom":"X","categorie":"X","duree":"X","calories":100,"difficulte":"X","description":"X","consignes":"X"}]}`);
    const data = JSON.parse(response.replace(/```json|```/g, '').trim());
    document.getElementById('sport-result').innerHTML = (data.exercices||[]).map(e => `
      <div class="sport-card"><span class="sport-icon">${e.emoji}</span><div class="sport-info"><h3>${e.nom}</h3>
      <div class="sport-tags"><span class="sport-tag highlight">${e.calories} kcal</span><span class="sport-tag">${e.duree}</span><span class="sport-tag">${e.difficulte}</span></div>
      <p class="sport-desc">${e.description}<br><br><em>${e.consignes}</em></p></div></div>
    `).join('');
    document.getElementById('sport-result').classList.remove('hidden');
  } catch(e) {} document.getElementById('sport-loading').classList.add('hidden');
};

async function loadDailyTip() {
  const t = ["Buvez de l'eau dès le réveil !", "Privilégiez les protéines au matin.", "Mâchez lentement pour la satiété.", "Évitez les sucres rapides isolés."];
  document.getElementById('daily-tip').textContent = t[new Date().getDay() % t.length];
  const s = ["🏃 15 min de marche post-repas", "🧘 Étirements doux le soir", "💪 Gainage 3x 1min aujourd'hui"];
  document.getElementById('dash-sport-tip').textContent = s[new Date().getDay() % s.length];
}

async function loadWeightHistory() {
  try {
    const q = query(collection(db, "users", currentUser.uid, "weights"), orderBy("date", "asc"));
    const snap = await getDocs(q);
    weightHistory = []; snap.forEach(d => weightHistory.push(d.data()));
    updateWeightStats();
  } catch (e) {}
}

window.saveWeight = async function() {
  const w = +document.getElementById('weight-input').value;
  const g = +document.getElementById('weight-goal-input').value;
  if (!w) return showToast("Entrez un poids.");
  try {
    await addDoc(collection(db, "users", currentUser.uid, "weights"), { weight: w, date: toDateKey(new Date()), createdAt: new Date().toISOString() });
    if(g) { userProfile.weightGoal = g; await saveProfileToFirebase(); }
    userProfile.weight = w; await saveProfileToFirebase();
    await loadWeightHistory(); renderWeightChart(); showToast(`Poids enregistré ✓`);
  } catch(e) {}
};

function updateWeightStats() {
  if (weightHistory.length === 0) return;
  const current = weightHistory[weightHistory.length-1].weight;
  document.getElementById('ws-current').textContent = current + ' kg';
  if (weightHistory.length > 1) document.getElementById('ws-diff').textContent = (current - weightHistory[weightHistory.length-2].weight).toFixed(1) + ' kg';
  if (userProfile.weightGoal) document.getElementById('ws-goal').textContent = userProfile.weightGoal + ' kg';
}

function renderWeightChart() {
  const canvas = document.getElementById('weight-chart');
  if (!canvas || weightHistory.length === 0) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.parentElement.clientWidth - 56; canvas.width = w; canvas.height = 200;
  ctx.clearRect(0, 0, w, 200);
  if (weightHistory.length < 2) return;
  const data = weightHistory.slice(-30);
  const weights = data.map(d=>d.weight);
  const min = Math.min(...weights) - 1, max = Math.max(...weights) + 1;
  const pad = {l:40, r:20, t:20, b:30}, plotW = w - pad.l - pad.r, plotH = 200 - pad.t - pad.b;
  const toX = i => pad.l + (i/(data.length-1))*plotW;
  const toY = v => pad.t + (1 - (v-min)/(max-min))*plotH;
  
  ctx.beginPath(); ctx.strokeStyle='#2c543b'; ctx.lineWidth=2.5; ctx.lineJoin='round';
  data.forEach((d,i)=>{ if(i===0) ctx.moveTo(toX(i),toY(d.weight)); else ctx.lineTo(toX(i),toY(d.weight)); });
  ctx.stroke();
  
  data.forEach((d,i)=>{
    ctx.beginPath(); ctx.arc(toX(i),toY(d.weight),4,0,Math.PI*2);
    ctx.fillStyle='#2c543b'; ctx.fill(); ctx.lineWidth=2; ctx.strokeStyle='white'; ctx.stroke();
    if(i===0||i===data.length-1) { ctx.fillStyle='#5f6f65'; ctx.font='10px sans'; ctx.fillText(d.date.slice(5), toX(i)-10, 200-5); }
  });
}

window.showToast = function(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
};
