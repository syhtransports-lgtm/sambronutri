// ===== SAMBRO NUTRI — APP.JS =====
// Firebase + Anthropic AI Integration

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

// Anthropic API (via proxy / direct)
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// ===== STATE =====
let currentUser = null;
let userProfile = {};
let journalDate = new Date();
let currentMealType = "";
let lastCalResult = null;
let weightHistory = [];

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    document.getElementById("auth-overlay").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    await loadUserProfile();
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
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    showAuthError(getFirebaseError(e.code));
  }
};

window.loginGoogle = async function() {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    showAuthError("Erreur de connexion Google.");
  }
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
  if (password.length < 6) return showAuthError("Mot de passe trop court (6 caractères minimum).");

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const profile = { name, email, age: +age||0, gender, weight: +weight||0, height: +height||0, calGoal: 2000, weightGoal: 0, createdAt: new Date().toISOString() };
    await setDoc(doc(db, "users", cred.user.uid), profile);
    userProfile = profile;
  } catch (e) {
    showAuthError(getFirebaseError(e.code));
  }
};

window.logoutUser = async function() {
  await signOut(auth);
};

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearAuthError() {
  document.getElementById('auth-error').classList.add('hidden');
}
function getFirebaseError(code) {
  const map = {
    'auth/user-not-found': 'Aucun compte avec cet email.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/email-already-in-use': 'Cet email est déjà utilisé.',
    'auth/invalid-email': 'Email invalide.',
    'auth/weak-password': 'Mot de passe trop faible.',
    'auth/invalid-credential': 'Email ou mot de passe incorrect.',
  };
  return map[code] || 'Une erreur est survenue. Réessayez.';
}

// ===== PROFILE =====
async function loadUserProfile() {
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (snap.exists()) {
      userProfile = snap.data();
    } else {
      userProfile = { name: currentUser.displayName || currentUser.email.split('@')[0], email: currentUser.email, calGoal: 2000, weightGoal: 0 };
      await setDoc(doc(db, "users", currentUser.uid), userProfile);
    }
  } catch (e) { console.error(e); }
}

async function saveProfileToFirebase() {
  try {
    await setDoc(doc(db, "users", currentUser.uid), userProfile, { merge: true });
  } catch (e) { console.error(e); }
}

// ===== INIT APP =====
async function initApp() {
  updateGreeting();
  updateDateDisplay();
  setProfileUI();
  loadJournalForDate();
  loadWeightHistory();
  setDashboardStats();
  loadDailyTip();

  // Set journal date label
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
  const now = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('today-date').textContent = now.toLocaleDateString('fr-FR', opts);
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
  updateGreeting();
  setDashboardStats();
  showToast("Profil sauvegardé ✓");
};

// ===== PAGE NAV =====
window.showPage = function(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  if (page === 'journal') loadJournalForDate();
  if (page === 'weight') renderWeightChart();
  if (page === 'dashboard') setDashboardStats();
  if (page === 'weight') { document.getElementById('ws-goal').textContent = userProfile.weightGoal ? userProfile.weightGoal + ' kg' : '–'; }
};

// ===== AI CALL =====
async function callAI(prompt, systemPrompt = "") {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }]
  };
  if (systemPrompt) body.system = systemPrompt;

  const response = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return data.content?.[0]?.text || "";
}

// ===== CALORIES =====
window.estimateCalories = async function() {
  const desc = document.getElementById('cal-input').value.trim();
  if (!desc) return showToast("Décrivez votre repas d'abord.");

  document.getElementById('cal-loading').classList.remove('hidden');
  document.getElementById('cal-result').classList.add('hidden');

  try {
    const response = await callAI(
      `Analyse ce repas et estime les calories et macronutriments. Réponds UNIQUEMENT en JSON valide, sans aucun texte autour:\n${desc}`,
      `Tu es un expert en nutrition. Réponds toujours en JSON valide avec cette structure exacte:
{
  "total_calories": 500,
  "items": [{"name": "aliment", "quantity": "200g", "calories": 300}],
  "macros": {"proteines": 30, "glucides": 50, "lipides": 15},
  "note": "commentaire nutritionnel bref"
}`
    );

    const clean = response.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    lastCalResult = { description: desc, calories: data.total_calories, data };

    document.getElementById('cal-total-badge').textContent = `${data.total_calories} kcal`;

    // Breakdown
    const breakdownEl = document.getElementById('cal-breakdown');
    breakdownEl.innerHTML = (data.items || []).map(item =>
      `<div class="cal-item"><span class="cal-item-name">${item.name} — ${item.quantity}</span><span class="cal-item-value">${item.calories} kcal</span></div>`
    ).join('');

    // Macros
    const m = data.macros || {};
    document.getElementById('cal-macros').innerHTML = `
      <div class="macro-item"><span class="macro-val">${m.proteines || 0}g</span><span class="macro-lbl">Protéines</span></div>
      <div class="macro-item"><span class="macro-val">${m.glucides || 0}g</span><span class="macro-lbl">Glucides</span></div>
      <div class="macro-item"><span class="macro-val">${m.lipides || 0}g</span><span class="macro-lbl">Lipides</span></div>
    `;

    document.getElementById('cal-result').classList.remove('hidden');
    if (data.note) showToast(`💡 ${data.note}`);
  } catch (e) {
    showToast("Erreur d'analyse. Vérifiez votre connexion.");
    console.error(e);
  } finally {
    document.getElementById('cal-loading').classList.add('hidden');
  }
};

window.addMealToJournal = async function() {
  if (!lastCalResult) return;
  const meal = {
    description: lastCalResult.description,
    calories: lastCalResult.calories,
    type: "Repas",
    date: toDateKey(new Date()),
    createdAt: new Date().toISOString()
  };
  await addMeal(meal);
  showToast("Repas ajouté au journal ✓");
};

// ===== RECIPES =====
window.generateRecipes = async function() {
  const ingredients = document.getElementById('recipe-ingredients').value.trim();
  const type = document.getElementById('recipe-type').value;
  const diet = document.getElementById('recipe-diet').value;

  if (!ingredients) return showToast("Entrez vos ingrédients d'abord.");

  document.getElementById('recipe-loading').classList.remove('hidden');
  document.getElementById('recipes-result').classList.add('hidden');
  document.getElementById('recipes-result').innerHTML = '';

  try {
    const prompt = `Ingrédients disponibles: ${ingredients}. ${type ? 'Type de repas: ' + type + '.' : ''} ${diet ? 'Régime: ' + diet + '.' : ''} Propose 4 recettes créatives et équilibrées.`;

    const response = await callAI(prompt,
      `Tu es un chef cuisinier expert en nutrition. Réponds UNIQUEMENT en JSON valide:
{
  "recettes": [
    {
      "emoji": "🍗",
      "nom": "Nom recette",
      "temps": "25 min",
      "calories": 450,
      "difficulte": "Facile",
      "description": "Description appétissante",
      "ingredients": "liste des ingrédients avec quantités",
      "etapes": "étapes courtes de préparation"
    }
  ]
}`
    );

    const clean = response.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    const recettes = data.recettes || [];

    const container = document.getElementById('recipes-result');
    container.innerHTML = recettes.map(r => `
      <div class="recipe-card">
        <span class="recipe-emoji">${r.emoji || '🍽️'}</span>
        <h3>${r.nom}</h3>
        <div class="recipe-meta">
          <span class="recipe-tag cal">🔥 ${r.calories} kcal</span>
          <span class="recipe-tag">⏱ ${r.temps}</span>
          <span class="recipe-tag">📊 ${r.difficulte}</span>
        </div>
        <p class="recipe-desc">${r.description}</p>
        <div class="recipe-ingredients"><strong>Ingrédients :</strong>${r.ingredients}</div>
        <div class="recipe-steps"><strong>Préparation :</strong><br/>${r.etapes}</div>
      </div>
    `).join('');

    container.classList.remove('hidden');
  } catch (e) {
    showToast("Erreur lors de la génération. Réessayez.");
    console.error(e);
  } finally {
    document.getElementById('recipe-loading').classList.add('hidden');
  }
};

// ===== JOURNAL =====
function toDateKey(date) {
  return date.toISOString().split('T')[0];
}

function updateJournalDateLabel() {
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  document.getElementById('journal-date-label').textContent = journalDate.toLocaleDateString('fr-FR', opts);
}

window.changeJournalDate = function(delta) {
  journalDate.setDate(journalDate.getDate() + delta);
  updateJournalDateLabel();
  loadJournalForDate();
};

async function loadJournalForDate() {
  const dateKey = toDateKey(journalDate);
  const types = { 'Petit-déjeuner': 'breakfast', 'Déjeuner': 'lunch', 'Dîner': 'dinner', 'Collation': 'snack' };

  // Clear all meal lists
  Object.values(types).forEach(id => {
    document.getElementById(`meal-${id}`).innerHTML = '';
  });

  try {
    const q = query(collection(db, "users", currentUser.uid, "meals"), where("date", "==", dateKey));
    const snap = await getDocs(q);
    const meals = [];
    snap.forEach(d => meals.push({ id: d.id, ...d.data() }));

    let total = 0;
    meals.forEach(meal => {
      const typeId = types[meal.type] || 'snack';
      const el = document.getElementById(`meal-${typeId}`);
      const div = document.createElement('div');
      div.className = 'meal-entry';
      div.innerHTML = `
        <span class="meal-entry-name">${meal.description}</span>
        <span class="meal-entry-cal">${meal.calories} kcal</span>
        <button class="meal-delete-btn" onclick="deleteMeal('${meal.id}')">✕</button>
      `;
      el.appendChild(div);
      total += meal.calories || 0;
    });

    document.getElementById('journal-total-cal').textContent = `${total} kcal`;
    if (toDateKey(journalDate) === toDateKey(new Date())) setDashboardStats();
  } catch (e) { console.error(e); }
}

async function addMeal(meal) {
  try {
    await addDoc(collection(db, "users", currentUser.uid, "meals"), meal);
    if (toDateKey(journalDate) === toDateKey(new Date())) {
      loadJournalForDate();
    }
  } catch (e) { console.error(e); }
}

window.deleteMeal = async function(id) {
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "meals", id));
    loadJournalForDate();
  } catch (e) { console.error(e); }
};

// Modal
window.openAddMeal = function(type) {
  currentMealType = type;
  document.getElementById('modal-meal-type').textContent = `Ajouter — ${type}`;
  document.getElementById('modal-meal-desc').value = '';
  document.getElementById('modal-meal-cal').value = '';
  document.getElementById('meal-modal').classList.remove('hidden');
};
window.closeMealModal = function() {
  document.getElementById('meal-modal').classList.add('hidden');
};

window.addMealEntry = async function() {
  const desc = document.getElementById('modal-meal-desc').value.trim();
  const cal = +document.getElementById('modal-meal-cal').value || 0;
  if (!desc) return showToast("Décrivez le repas.");

  let calories = cal;
  if (!cal) {
    showToast("Estimation des calories en cours...");
    try {
      const response = await callAI(
        `Estime les calories de: ${desc}. Réponds UNIQUEMENT avec un nombre entier.`,
        "Tu es expert en nutrition. Réponds uniquement avec un nombre entier représentant les calories estimées."
      );
      calories = parseInt(response.replace(/\D/g,'')) || 300;
    } catch (e) { calories = 300; }
  }

  const meal = {
    description: desc, calories,
    type: currentMealType,
    date: toDateKey(journalDate),
    createdAt: new Date().toISOString()
  };
  await addMeal(meal);
  closeMealModal();
  showToast(`Repas ajouté — ${calories} kcal ✓`);
};

// ===== DASHBOARD STATS =====
async function setDashboardStats() {
  try {
    const dateKey = toDateKey(new Date());
    const q = query(collection(db, "users", currentUser.uid, "meals"), where("date", "==", dateKey));
    const snap = await getDocs(q);
    let total = 0;
    const mealsList = [];
    snap.forEach(d => { const m = d.data(); total += m.calories || 0; mealsList.push(m); });

    const goal = userProfile.calGoal || 2000;
    const remaining = Math.max(0, goal - total);
    const pct = Math.min(100, Math.round((total / goal) * 100));

    document.getElementById('dash-cal-consumed').textContent = total;
    document.getElementById('dash-cal-goal').textContent = goal;
    document.getElementById('dash-cal-remaining').textContent = remaining;
    document.getElementById('dash-progress-pct').textContent = pct + '%';
    document.getElementById('dash-progress-bar').style.width = pct + '%';

    // Latest weight
    if (weightHistory.length > 0) {
      document.getElementById('dash-weight').textContent = weightHistory[weightHistory.length - 1].weight + ' kg';
    } else if (userProfile.weight) {
      document.getElementById('dash-weight').textContent = userProfile.weight + ' kg';
    }

    // Meals list in dashboard
    const dashMeals = document.getElementById('dash-meals-list');
    if (mealsList.length === 0) {
      dashMeals.innerHTML = '<p class="empty-state">Aucun repas enregistré aujourd\'hui.</p>';
    } else {
      dashMeals.innerHTML = mealsList.slice(0, 4).map(m =>
        `<div class="meal-entry"><span class="meal-entry-name">${m.description.substring(0,35)}...</span><span class="meal-entry-cal">${m.calories} kcal</span></div>`
      ).join('');
    }
  } catch (e) { console.error(e); }
}

// ===== DAILY TIP =====
async function loadDailyTip() {
  const tips = [
    "Commencez la journée avec un grand verre d'eau. L'hydratation favorise le métabolisme et réduit les fringales matinales.",
    "Privilégiez les protéines maigres à chaque repas pour prolonger la satiété et préserver la masse musculaire.",
    "Mâchez lentement : votre cerveau met 20 minutes à enregistrer la satiété. Mangez en pleine conscience.",
    "Les légumes verts à chaque repas apportent fibres, vitamines et minéraux essentiels à votre bien-être.",
    "Une promenade de 30 minutes après le dîner améliore la digestion et régule la glycémie.",
    "Évitez les écrans pendant les repas pour manger plus lentement et apprécier chaque bouchée.",
    "Un petit-déjeuner riche en protéines réduit les envies sucrées tout au long de la journée.",
  ];
  const tip = tips[new Date().getDay() % tips.length];
  document.getElementById('daily-tip').textContent = tip;

  const sportTips = [
    "🏃 10 min de marche rapide après chaque repas — simple et efficace !",
    "🧘 5 minutes de respiration profonde ce soir pour réduire le cortisol.",
    "💪 3 séries de 15 squats sans équipement pour activer vos jambes.",
    "🚴 30 minutes de vélo modéré brûlent environ 250 kcal.",
    "🏊 La natation est l'exercice idéal pour travailler tout le corps sans impact.",
  ];
  document.getElementById('dash-sport-tip').textContent = sportTips[new Date().getDay() % sportTips.length];
}

// ===== WEIGHT =====
async function loadWeightHistory() {
  try {
    const q = query(collection(db, "users", currentUser.uid, "weights"), orderBy("date", "asc"));
    const snap = await getDocs(q);
    weightHistory = [];
    snap.forEach(d => weightHistory.push(d.data()));
    updateWeightStats();
  } catch (e) { console.error(e); }
}

window.saveWeight = async function() {
  const w = +document.getElementById('weight-input').value;
  const g = +document.getElementById('weight-goal-input').value;
  if (!w) return showToast("Entrez votre poids.");

  const entry = { weight: w, date: toDateKey(new Date()), createdAt: new Date().toISOString() };
  try {
    await addDoc(collection(db, "users", currentUser.uid, "weights"), entry);
    if (g) {
      userProfile.weightGoal = g;
      await saveProfileToFirebase();
    }
    userProfile.weight = w;
    await saveProfileToFirebase();
    await loadWeightHistory();
    renderWeightChart();
    showToast(`Poids enregistré: ${w} kg ✓`);
    setDashboardStats();
  } catch (e) { console.error(e); }
};

function updateWeightStats() {
  if (weightHistory.length === 0) return;
  const current = weightHistory[weightHistory.length - 1].weight;
  document.getElementById('ws-current').textContent = current + ' kg';
  document.getElementById('dash-weight').textContent = current + ' kg';

  if (weightHistory.length > 1) {
    const prev = weightHistory[weightHistory.length - 2].weight;
    const diff = (current - prev).toFixed(1);
    document.getElementById('ws-diff').textContent = (diff > 0 ? '+' : '') + diff + ' kg';
  }
  if (userProfile.weightGoal) {
    document.getElementById('ws-goal').textContent = userProfile.weightGoal + ' kg';
  }
}

function renderWeightChart() {
  const canvas = document.getElementById('weight-chart');
  if (!canvas || weightHistory.length === 0) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.parentElement.clientWidth - 56;
  canvas.width = w;
  canvas.height = 200;
  ctx.clearRect(0, 0, w, 200);

  if (weightHistory.length < 2) {
    ctx.font = '14px DM Sans';
    ctx.fillStyle = '#aaa';
    ctx.textAlign = 'center';
    ctx.fillText('Enregistrez plus de données pour voir le graphique.', w/2, 100);
    return;
  }

  const data = weightHistory.slice(-30);
  const weights = data.map(d => d.weight);
  const min = Math.min(...weights) - 1;
  const max = Math.max(...weights) + 1;
  const pad = { left: 40, right: 20, top: 20, bottom: 30 };
  const plotW = w - pad.left - pad.right;
  const plotH = 200 - pad.top - pad.bottom;

  const toX = (i) => pad.left + (i / (data.length - 1)) * plotW;
  const toY = (v) => pad.top + (1 - (v - min) / (max - min)) * plotH;

  // Grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    const val = (max - (i / 4) * (max - min)).toFixed(1);
    ctx.fillStyle = '#aaa'; ctx.font = '11px DM Sans'; ctx.textAlign = 'right';
    ctx.fillText(val, pad.left - 6, y + 4);
  }

  // Gradient fill
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  grad.addColorStop(0, 'rgba(77,122,94,0.2)');
  grad.addColorStop(1, 'rgba(77,122,94,0)');
  ctx.beginPath();
  ctx.moveTo(toX(0), toY(weights[0]));
  data.forEach((d, i) => { if (i > 0) ctx.lineTo(toX(i), toY(d.weight)); });
  ctx.lineTo(toX(data.length - 1), pad.top + plotH);
  ctx.lineTo(toX(0), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.strokeStyle = '#4d7a5e'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  data.forEach((d, i) => {
    if (i === 0) ctx.moveTo(toX(i), toY(d.weight));
    else ctx.lineTo(toX(i), toY(d.weight));
  });
  ctx.stroke();

  // Goal line
  if (userProfile.weightGoal && userProfile.weightGoal >= min && userProfile.weightGoal <= max) {
    const gy = toY(userProfile.weightGoal);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#c4956a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(w - pad.right, gy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#c4956a'; ctx.font = '11px DM Sans'; ctx.textAlign = 'left';
    ctx.fillText('Objectif', w - pad.right + 4, gy + 4);
  }

  // Dots
  data.forEach((d, i) => {
    ctx.beginPath();
    ctx.arc(toX(i), toY(d.weight), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#4d7a5e'; ctx.fill();
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
  });

  // X labels
  ctx.fillStyle = '#aaa'; ctx.font = '10px DM Sans'; ctx.textAlign = 'center';
  const step = Math.max(1, Math.floor(data.length / 6));
  data.forEach((d, i) => {
    if (i % step === 0 || i === data.length - 1) {
      const label = d.date.slice(5); // MM-DD
      ctx.fillText(label, toX(i), 200 - 6);
    }
  });
}

// ===== SPORT =====
window.generateSportPlan = async function() {
  const level = document.getElementById('sport-level').value;
  const goal = document.getElementById('sport-goal').value;
  const equipment = document.getElementById('sport-equipment').value;

  document.getElementById('sport-loading').classList.remove('hidden');
  document.getElementById('sport-result').classList.add('hidden');

  try {
    const prompt = `Niveau: ${level}, Objectif: ${goal}, Équipement: ${equipment || 'aucun'}. Profil: ${userProfile.age||30} ans, ${userProfile.gender||'non spécifié'}, ${userProfile.weight||70}kg, ${userProfile.height||170}cm.`;

    const response = await callAI(prompt,
      `Tu es un coach sportif professionnel. Propose un programme de 5 exercices adaptés. Réponds UNIQUEMENT en JSON valide:
{
  "exercices": [
    {
      "emoji": "🏃",
      "nom": "Nom de l'exercice",
      "categorie": "Cardio",
      "duree": "20 min",
      "calories": 200,
      "difficulte": "Facile",
      "description": "Description et bénéfices",
      "consignes": "Instructions courtes pour bien exécuter"
    }
  ]
}`
    );

    const clean = response.replace(/```json|```/g, '').trim();
    const data = JSON.parse(clean);
    const exercices = data.exercices || [];

    const container = document.getElementById('sport-result');
    container.innerHTML = exercices.map(e => `
      <div class="sport-card">
        <span class="sport-icon">${e.emoji || '💪'}</span>
        <div class="sport-info">
          <h3>${e.nom}</h3>
          <div class="sport-tags">
            <span class="sport-tag highlight">🔥 ${e.calories} kcal</span>
            <span class="sport-tag">⏱ ${e.duree}</span>
            <span class="sport-tag">${e.categorie}</span>
            <span class="sport-tag">${e.difficulte}</span>
          </div>
          <p class="sport-desc">${e.description}</p>
          <p class="sport-desc" style="margin-top:0.5rem;font-style:italic">${e.consignes}</p>
        </div>
      </div>
    `).join('');
    container.classList.remove('hidden');
  } catch (e) {
    showToast("Erreur de génération. Réessayez.");
    console.error(e);
  } finally {
    document.getElementById('sport-loading').classList.add('hidden');
  }
};

// ===== TOAST =====
window.showToast = function(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 3000);
};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  updateJournalDateLabel();
});
