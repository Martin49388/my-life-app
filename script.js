const STORAGE_KEY = "habits";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadHabits() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveHabits(habits) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(habits));
}

let habits = loadHabits();

function addHabit(name) {
  habits.push({ id: crypto.randomUUID(), name, doneDates: [] });
  saveHabits(habits);
  render();
}

function toggleToday(id) {
  const habit = habits.find((h) => h.id === id);
  const today = todayKey();
  const doneIndex = habit.doneDates.indexOf(today);
  if (doneIndex === -1) {
    habit.doneDates.push(today);
  } else {
    habit.doneDates.splice(doneIndex, 1);
  }
  saveHabits(habits);
  render();
}

function deleteHabit(id) {
  habits = habits.filter((h) => h.id !== id);
  saveHabits(habits);
  render();
}

function render() {
  const list = document.getElementById("habit-list");
  const today = todayKey();
  list.innerHTML = "";

  for (const habit of habits) {
    const isDone = habit.doneDates.includes(today);

    const li = document.createElement("li");
    li.className = isDone ? "done" : "";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isDone;
    checkbox.addEventListener("change", () => toggleToday(habit.id));

    const name = document.createElement("span");
    name.className = "habit-name" + (isDone ? " done" : "");
    name.textContent = habit.name;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", () => deleteHabit(habit.id));

    li.append(checkbox, name, deleteBtn);
    list.appendChild(li);
  }
}

document.getElementById("add-habit-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("habit-name-input");
  const name = input.value.trim();
  if (name) {
    addHabit(name);
    input.value = "";
  }
});

render();
