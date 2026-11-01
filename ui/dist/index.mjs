import * as sdk from "@kirocrew/app-sdk";
import { activeLocale, useAppApi, useChatLauncher, useImeGuard, useLanguageGeneration } from "@kirocrew/app-sdk";
import { useCallback, useMemo, useState } from "react";
import { Clock, Folder, FolderPlus, Globe, Lightbulb, MessageCirclePlus, Pencil, Plus, Search, ShoppingBag, ShoppingCart, SkipForward, Tag, ThumbsUp, Trash2, X } from "lucide-react";
import * as ui from "@kirocrew/app-sdk/ui";
import { Btn, EmptyState, ErrorNotice, Input, PageHeader, SegmentedControl } from "@kirocrew/app-sdk/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { jsx, jsxs } from "react/jsx-runtime";
// src/api.ts
/**
* Personal Shopper API client: the host's permission-scoped client
* (`useAppApi()`), confined to the `permissions.api` paths in app.json.
*
* A refusal surfaces as an `Error` whose message is the backend's `code`
* (`invalid_field_type`, `owner_only`, ...), or `http_<status>` when the body
* carries none. The backend's `error` prose is untranslated English meant for
* logs; the code is the contract the UI can localize (RFC 9457 3.1.3), so the
* prose is never shown.
*/
var BASE = "/api/apps/personal-shopper";
function isApiError(e) {
	return typeof e === "object" && e !== null && typeof e.status === "number" && typeof e.body === "string";
}
/** The machine-readable code of a refused request, as an `Error`. Anything else is rethrown. */
function toCodeError(e) {
	if (!isApiError(e)) throw e;
	let code = `http_${e.status}`;
	try {
		const parsed = JSON.parse(e.body);
		if (parsed && typeof parsed === "object" && typeof parsed.code === "string") code = parsed.code;
	} catch {}
	throw new Error(code);
}
function shopApiFrom(api) {
	const run = (call) => call.catch(toCodeError);
	return {
		get: (path) => run(api.get(`${BASE}${path}`)),
		post: (path, body) => run(api.post(`${BASE}${path}`, body)),
		put: (path, body) => run(api.put(`${BASE}${path}`, body)),
		del: (path) => run(api.del(`${BASE}${path}`))
	};
}
function useShopApi() {
	const api = useAppApi();
	return useMemo(() => shopApiFrom(api), [api]);
}
// src/NativeSelect.tsx
/**
* The fallback for `Select` on a host that does not export one: a plain native
* `<select>` with the same props, so the call sites do not branch.
*/
function NativeSelect({ options, optionLabels, value, onChange, clearLabel, disabled, "aria-label": ariaLabel, title, className }) {
	const emptyRow = clearLabel !== void 0 || !options.includes(value);
	return /* @__PURE__ */ jsxs("select", {
		value,
		onChange: (e) => onChange(e.target.value),
		disabled,
		"aria-label": ariaLabel,
		title,
		className: "text-sm px-2 py-1 rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]" + (className ? ` ${className}` : ""),
		children: [emptyRow && /* @__PURE__ */ jsx("option", {
			value: "",
			children: clearLabel ?? ""
		}), options.map((option, index) => /* @__PURE__ */ jsx("option", {
			value: option,
			children: optionLabels?.[index] ?? option
		}, option))]
	});
}
// src/hostSdk.ts
/**
* Host names added at App Kit level 1, feature-detected.
*
* A named import of an export the host's module does not have fails the whole
* bundle at link time, so a host older than these seams would show a broken page
* instead of a slightly plainer one. These names are therefore read off namespace
* imports, each through an `in` check (the explicit "does this module export it"
* question), and each has a local fallback. Names every supported host has are
* named-imported where they are used.
*/
var hostFmtCurrency = "fmtCurrency" in sdk ? sdk.fmtCurrency : void 0;
/** Money in the active locale. An older host formats through `fmtNumber`. */
function fmtCurrency(value, currency = "USD") {
	if (typeof hostFmtCurrency === "function") return hostFmtCurrency(value, currency);
	return sdk.fmtNumber(value, {
		style: "currency",
		currency
	});
}
/** Spread onto a control that removes something; the guide shows its caution line there. */
var caution = ("guideCaution" in ui ? ui.guideCaution : void 0) ?? {};
/** The host's inline dropdown, or a native `<select>` on a host without one. */
var Select = ("Select" in ui ? ui.Select : void 0) ?? NativeSelect;
// src/i18n.ts
/**
* The app's own strings. A bundle cannot read the dashboard's catalogs (those
* belong to the host and change with it), so every locale the dashboard ships is
* bundled here and looked up against the host's active language.
*
* Lookup order: the exact locale (`pt`, `zh-CN`), then its base language, then
* English, then the key itself, so a missing translation shows English rather
* than nothing. `{{name}}` placeholders are filled from `vars`; one with no value
* is left as written.
*
* `t` reads the language at call time. The root component subscribes to the
* host's language changes (`useLanguageGeneration`), and its re-render reaches
* every child, so a language switch repaints the page without a reload.
*/
var CATALOGS = {
	bn: {
		manifest: {
			"description": "একজন ব্যক্তিগত পরামর্শদাতা, যে সত্যিকারের স্টোরের তথ্য খুঁজে দেখে এবং এমন সমস্যা সমাধানে সাহায্য করে যার শেষ কেনাকাটায় নাও হতে পারে। পছন্দ ট্যাব আপনার নিজের তালিকা — দরকারি অংশ আলাপে তুলে দিন। এটি কখনও কিছু কেনে না — কেনেন আপনি।",
			"display_name": "Personal Shopper",
			"use_case_1": "সিদ্ধান্ত, cart, account ও checkout নিজের নিয়ন্ত্রণে রেখে নাম দেওয়া public store থেকে product খুঁজে দেখুন।",
			"configuration_1": "কোনো store credential লাগে না; নিজের তথ্যসূত্র হিসেবে ঐচ্ছিক Preferences ও Sites সংরক্ষণ করুন, তারপর প্রাসঙ্গিক সীমাবদ্ধতা ও store-এর নাম advisor-এর সঙ্গে কথোপকথনে paste করুন।",
			"highlight_1": "কিছু সুপারিশ করার আগে সমস্যাটি বোঝে — কখনও উত্তরটা কেনা নয়",
			"highlight_2": "দরকারি পছন্দগুলো আলাপে তুলে দিন — পরামর্শদাতা আপনার বার্তা পড়ে, পছন্দ ট্যাব নয়",
			"highlight_3": "আপনি যে স্টোরগুলোর নাম বলেন কেবল সেগুলোই দেখে, আর জানিয়ে দেয় যে দাম সর্বজনীন পেজ থেকে, আপনার অ্যাকাউন্ট থেকে নয়",
			"highlight_4": "কার্ট বা চেকআউট পর্যন্ত পৌঁছানোর কোনো উপায়ই এর নেই",
			"highlight_5": "পছন্দ ট্যাবে সংরক্ষণ করা পছন্দগুলো দলে সাজিয়ে নিন",
			"page_label": "Personal Shopper"
		},
		historyTab: {
			"liked": "পছন্দ",
			"loading_history": "ইতিহাস লোড হচ্ছে…",
			"no_history_yet": "এখনও কোনো ইতিহাস নেই",
			"no_products_recommended_advice_was_the_solution": "কোনো পণ্য সুপারিশ করা হয়নি — পরামর্শই ছিল সমাধান",
			"no_sessions_matching": "“{{query}}” এর সাথে মেলে এমন কোনো সেশন নেই",
			"purchased": "কেনা হয়েছে",
			"search_past_sessions": "আগের সেশন খোঁজো…",
			"skipped": "বাদ দেওয়া",
			"your_past_advisor_conversations_and_recommendati": "তোমার আগের পরামর্শ-আলাপ আর সুপারিশ এখানে দেখা যাবে।",
			"mark_liked": "পছন্দ হিসেবে চিহ্নিত করো",
			"mark_purchased": "কেনা হিসেবে চিহ্নিত করো",
			"mark_skipped": "বাদ দেওয়া হিসেবে চিহ্নিত করো",
			"change_feedback": "মত বদলাও"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "এমন কিছু বলো যেমন “দৌড়ানোর জুতো খুঁজতে সাহায্য করো” বা “আমার মেয়ের জন্মদিন আসছে”",
			"start_a_conversation_with_your_personal_advisor": "যেকোনো চ্যাট সেশনে তোমার ব্যক্তিগত পরামর্শদাতার সঙ্গে আলাপ শুরু করো।",
			"start_advisor_conversation": "পরামর্শদাতার সাথে কথা বলুন",
			"start_conversation_failed": "কথা বলা শুরু করা যায়নি ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "রোজকার সমস্যার পরামর্শদাতা — আগে সমাধান, পরে কেনাকাটা",
			"tab_preferences": "পছন্দ",
			"tab_history": "ইতিহাস",
			"tab_sites": "সাইট"
		},
		preferencesTab: {
			"add": "যোগ করো",
			"add_a_preference_e_g_shoe_size_us_10": "পছন্দ যোগ করো (যেমন “জুতোর মাপ US 10”)",
			"add_group": "গ্রুপ যোগ করো",
			"cancel": "বাতিল",
			"create": "তৈরি করো",
			"delete": "মুছে ফেলো",
			"delete_group_keeps_preferences": "গ্রুপ মুছে ফেলো (পছন্দ থেকে যাবে)",
			"edit": "সম্পাদনা",
			"group_name": "গ্রুপের নাম",
			"loading_preferences": "পছন্দ লোড হচ্ছে…",
			"no_items_in_this_group": "এই গ্রুপে কিছু নেই",
			"no_preferences_yet": "এখনও কোনো পছন্দ নেই",
			"save": "সংরক্ষণ করো",
			"ungrouped": "গ্রুপ ছাড়া",
			"assign_to_group": "গ্রুপে দাও",
			"no_group": "কোনো গ্রুপ নয়",
			"delete_named_group": "“{{name}}” গ্রুপ মুছে ফেলো",
			"edit_named_preference": "“{{text}}” পছন্দ সম্পাদনা করো",
			"delete_named_preference": "“{{text}}” পছন্দ মুছে ফেলো",
			"add_your_first_preference": "উপরে একটি যোগ করো।",
			"the_advisor_cannot_read_this_list_paste_what_ma": "পরামর্শদাতা এই তালিকা পড়তে পারে না। জিজ্ঞাসা করার সময় দরকারি অংশ আলাপে তুলে দিন।"
		},
		sitesTab: {
			"add_shopping_site": "কেনাকাটার সাইট যোগ করো",
			"add_site": "সাইট যোগ করো",
			"add_your_shopping_sites_so_the_advisor_can_brows": "যে দোকানগুলো নজরে রাখতে চান, সেগুলো যোগ করুন।",
			"cancel": "বাতিল",
			"how_login_works": "খোঁজ কীভাবে হয়",
			"loading_sites": "সাইট লোড হচ্ছে…",
			"no_sites_configured": "কোনো সাইট সেট করা নেই",
			"privacy": "গোপনীয়তা",
			"remove_site": "সাইট সরাও",
			"shopping_sources_the_advisor_can_browse_login_en": "পরামর্শদাতা এই তালিকা পড়তে পারে না। আলাপে কোনো দোকানের নাম বললে সেটিই দেখবে — এটি আপনার নিজের রেফারেন্স তালিকা।",
			"site_name_e_g_example_store": "সাইটের নাম (যেমন Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "এখানকার কিছুই আপনার যন্ত্র ছেড়ে যায় না।",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "পরামর্শদাতা কেবল সর্বজনীন দোকানের পেজ পড়ে। এটি লগ ইন করতে পারে না, আপনার সেশনও ব্যবহার করতে পারে না, তাই দাম আর স্টক সর্বজনীন পেজ থেকেই আসে।",
			"url_e_g_store_example_com": "URL (যেমন store.example.com)",
			"remove_named_site": "{{name}} সরাও",
			"save_failed": "সংরক্ষণ করা যায়নি। ত্রুটি কোড: {{code}}"
		},
		common: { "something_went_wrong": "কিছু ভুল হয়েছে" }
	},
	de: {
		manifest: {
			"description": "Ein persönlicher Berater, der echte Shops recherchiert und Probleme löst, die nicht zwangsläufig in einem Kauf enden. Der Tab Vorlieben ist Ihre eigene Referenzliste – schreiben Sie das Wichtige in den Chat. Er kauft nie etwas – das tun Sie.",
			"display_name": "Personal Shopper",
			"highlight_1": "Analysiert das Problem, bevor er etwas empfiehlt – manchmal ist die Antwort gar kein Kauf",
			"highlight_2": "Schreiben Sie die wichtigen Vorlieben in den Chat – der Berater liest Ihre Nachrichten, nicht den Tab Vorlieben",
			"highlight_3": "Recherchiert nur die Shops, die Sie nennen, und weist darauf hin, dass Preise von öffentlichen Seiten kommen und nicht aus Ihrem Konto",
			"highlight_4": "Er kann Warenkorb und Kasse gar nicht erreichen",
			"highlight_5": "Ordnen Sie Ihre gespeicherten Vorlieben im Tab Vorlieben in Gruppen",
			"page_label": "Personal Shopper",
			"use_case_1": "Recherchiere Produkte in benannten öffentlichen Shops und behalte Entscheidung, Warenkorb, Konto und Bezahlvorgang selbst unter Kontrolle.",
			"configuration_1": "Shop-Zugangsdaten sind nicht nötig; speichere optional Preferences und Sites als eigene Referenz und füge dann die relevanten Anforderungen und Shopnamen in die Berater-Unterhaltung ein."
		},
		historyTab: {
			"liked": "Gefällt mir",
			"loading_history": "Verlauf wird geladen…",
			"no_history_yet": "Noch kein Verlauf",
			"no_products_recommended_advice_was_the_solution": "Keine Produkte empfohlen — der Rat war die Lösung",
			"no_sessions_matching": "Keine Sitzungen für „{{query}}“",
			"purchased": "Gekauft",
			"search_past_sessions": "Frühere Sitzungen durchsuchen…",
			"skipped": "Übersprungen",
			"your_past_advisor_conversations_and_recommendati": "Deine früheren Berater-Gespräche und Empfehlungen erscheinen hier.",
			"mark_liked": "Als „gefällt mir“ markieren",
			"mark_purchased": "Als gekauft markieren",
			"mark_skipped": "Als übersprungen markieren",
			"change_feedback": "Bewertung ändern"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "Sag etwas wie „hilf mir, Laufschuhe zu finden“ oder „meine Tochter hat bald Geburtstag“",
			"start_a_conversation_with_your_personal_advisor": "Starte in jeder Chat-Sitzung ein Gespräch mit deinem persönlichen Berater.",
			"start_advisor_conversation": "Beratungsgespräch starten",
			"start_conversation_failed": "Gespräch konnte nicht gestartet werden ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "Dein Berater für Alltagsprobleme — löst zuerst, kauft später",
			"tab_preferences": "Vorlieben",
			"tab_history": "Verlauf",
			"tab_sites": "Seiten"
		},
		preferencesTab: {
			"add": "Hinzufügen",
			"add_a_preference_e_g_shoe_size_us_10": "Vorliebe hinzufügen (z. B. „Schuhgröße US 10“)",
			"add_group": "Gruppe hinzufügen",
			"cancel": "Abbrechen",
			"create": "Erstellen",
			"delete": "Löschen",
			"delete_group_keeps_preferences": "Gruppe löschen (Vorlieben bleiben)",
			"edit": "Bearbeiten",
			"group_name": "Gruppenname",
			"loading_preferences": "Vorlieben werden geladen…",
			"no_items_in_this_group": "Keine Einträge in dieser Gruppe",
			"no_preferences_yet": "Noch keine Vorlieben",
			"save": "Speichern",
			"ungrouped": "Ohne Gruppe",
			"assign_to_group": "Einer Gruppe zuordnen",
			"no_group": "Keine Gruppe",
			"delete_named_group": "Gruppe {{name}} löschen",
			"edit_named_preference": "Vorliebe „{{text}}“ bearbeiten",
			"delete_named_preference": "Vorliebe „{{text}}“ löschen",
			"add_your_first_preference": "Füge oben eine hinzu.",
			"the_advisor_cannot_read_this_list_paste_what_ma": "Der Berater kann diese Liste nicht lesen. Schreiben Sie das Wichtige in den Chat, wenn Sie fragen."
		},
		sitesTab: {
			"add_shopping_site": "Shopping-Seite hinzufügen",
			"add_site": "Seite hinzufügen",
			"add_your_shopping_sites_so_the_advisor_can_brows": "Fügen Sie die Shops hinzu, die Sie im Blick behalten wollen.",
			"cancel": "Abbrechen",
			"how_login_works": "So funktioniert die Recherche",
			"loading_sites": "Seiten werden geladen…",
			"no_sites_configured": "Keine Seiten eingerichtet",
			"privacy": "Datenschutz",
			"remove_site": "Seite entfernen",
			"shopping_sources_the_advisor_can_browse_login_en": "Der Berater kann diese Liste nicht lesen. Nennen Sie einen Shop im Chat, dann recherchiert er genau diesen – dies ist Ihre eigene Referenzliste.",
			"site_name_e_g_example_store": "Seitenname (z. B. Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "Nichts hiervon verlässt Ihren Rechner.",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "Der Berater liest nur öffentliche Shop-Seiten. Er kann sich nicht anmelden und Ihre Sitzung nicht nutzen, daher stammen Preise und Verfügbarkeit von der öffentlichen Seite.",
			"url_e_g_store_example_com": "URL (z. B. store.example.com)",
			"remove_named_site": "{{name}} entfernen",
			"save_failed": "Speichern fehlgeschlagen. Fehlercode: {{code}}"
		},
		common: { "something_went_wrong": "Etwas ist schiefgelaufen" }
	},
	en: {
		manifest: {
			"description": "A personal advisor that researches real stores and helps solve problems that may or may not end in a purchase. The Preferences tab is your own reference list — paste what matters into chat. It never buys anything — you do.",
			"display_name": "Personal Shopper",
			"highlight_1": "Diagnoses the problem before recommending anything — sometimes the answer is not a purchase at all",
			"highlight_2": "Paste the preferences that matter into chat — the advisor reads your messages, not the Preferences tab",
			"highlight_3": "Researches only the stores you name, and flags that prices come from public pages, not your signed-in account",
			"highlight_4": "It has no way to reach a cart or a checkout",
			"highlight_5": "Organize your saved preferences into groups in the Preferences tab",
			"page_label": "Personal Shopper",
			"use_case_1": "Research products from named public stores while keeping the decision, cart, account, and checkout under your control.",
			"configuration_1": "No store credentials are needed; save optional Preferences and Sites for your own reference, then paste the relevant constraints and store names into the advisor conversation."
		},
		historyTab: {
			"liked": "Liked",
			"loading_history": "Loading history...",
			"no_history_yet": "No history yet",
			"no_products_recommended_advice_was_the_solution": "No products recommended — advice was the solution",
			"no_sessions_matching": "No sessions matching \"{{query}}\"",
			"purchased": "Purchased",
			"search_past_sessions": "Search past sessions...",
			"skipped": "Skipped",
			"your_past_advisor_conversations_and_recommendati": "Your past advisor conversations and recommendations will appear here.",
			"mark_liked": "Mark as liked",
			"mark_purchased": "Mark as purchased",
			"mark_skipped": "Mark as skipped",
			"change_feedback": "Change feedback"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "Say something like \"help me find running shoes\" or \"my daughter's birthday is coming up\"",
			"start_a_conversation_with_your_personal_advisor": "Start a conversation with your personal advisor in any chat session.",
			"start_advisor_conversation": "Start advisor conversation",
			"start_conversation_failed": "Couldn't start the conversation ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "Your life-problem advisor — solves first, shops second",
			"tab_preferences": "Preferences",
			"tab_history": "History",
			"tab_sites": "Sites"
		},
		preferencesTab: {
			"add": "Add",
			"add_a_preference_e_g_shoe_size_us_10": "Add a preference (e.g. \"shoe size US 10\")",
			"add_group": "Add group",
			"cancel": "Cancel",
			"create": "Create",
			"delete": "Delete",
			"delete_group_keeps_preferences": "Delete group (keeps preferences)",
			"edit": "Edit",
			"group_name": "Group name",
			"loading_preferences": "Loading preferences...",
			"no_items_in_this_group": "No items in this group",
			"no_preferences_yet": "No preferences yet",
			"save": "Save",
			"ungrouped": "Ungrouped",
			"assign_to_group": "Assign to group",
			"no_group": "No group",
			"delete_named_group": "Delete group {{name}}",
			"edit_named_preference": "Edit preference “{{text}}”",
			"delete_named_preference": "Delete preference “{{text}}”",
			"add_your_first_preference": "Add one above, or import them later.",
			"the_advisor_cannot_read_this_list_paste_what_ma": "The advisor cannot read this list. Paste what matters into the chat when you ask."
		},
		sitesTab: {
			"add_shopping_site": "Add shopping site",
			"add_site": "Add site",
			"add_your_shopping_sites_so_the_advisor_can_brows": "Add the shopping sites you want to keep track of.",
			"cancel": "Cancel",
			"how_login_works": "How research works",
			"loading_sites": "Loading sites...",
			"no_sites_configured": "No sites configured",
			"privacy": "Privacy",
			"remove_site": "Remove site",
			"shopping_sources_the_advisor_can_browse_login_en": "The advisor cannot read this list. Name a store in chat and it will research that one — this is your own reference list.",
			"site_name_e_g_example_store": "Site name (e.g. Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "Nothing here leaves your machine.",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "The advisor reads public store pages only. It cannot sign in to a store or use your session, so prices and stock come from the public page.",
			"url_e_g_store_example_com": "URL (e.g. store.example.com)",
			"remove_named_site": "Remove {{name}}",
			"save_failed": "Could not save. Error code: {{code}}"
		},
		common: { "something_went_wrong": "Something went wrong" }
	},
	es: {
		manifest: {
			"description": "Un asesor personal que investiga tiendas reales y ayuda a resolver problemas que puede que no terminen en una compra. La pestaña Preferencias es tu propia lista de referencia: pega en el chat lo que importe. Nunca compra nada: eso lo haces tú.",
			"display_name": "Personal Shopper",
			"highlight_1": "Diagnostica el problema antes de recomendar nada: a veces la respuesta no es una compra",
			"highlight_2": "Pega en el chat las preferencias que importen: el asesor lee tus mensajes, no la pestaña Preferencias",
			"highlight_3": "Investiga solo las tiendas que le nombres, y avisa de que los precios vienen de páginas públicas, no de tu cuenta",
			"highlight_4": "No tiene forma de llegar al carrito ni al pago",
			"highlight_5": "Organiza tus preferencias guardadas en grupos en la pestaña Preferencias",
			"page_label": "Personal Shopper",
			"use_case_1": "Investiga productos en las tiendas públicas indicadas mientras mantienes bajo tu control la decisión, el carrito, la cuenta y el pago.",
			"configuration_1": "No necesitas credenciales de las tiendas; guarda de forma opcional Preferences y Sites como referencia y pega en la conversación con el asesor las restricciones y los nombres de tiendas relevantes."
		},
		historyTab: {
			"liked": "Me gusta",
			"loading_history": "Cargando el historial…",
			"no_history_yet": "Aún no hay historial",
			"no_products_recommended_advice_was_the_solution": "Ningún producto recomendado — el consejo fue la solución",
			"no_sessions_matching": "No hay sesiones que coincidan con «{{query}}»",
			"purchased": "Comprado",
			"search_past_sessions": "Buscar en sesiones anteriores…",
			"skipped": "Omitido",
			"your_past_advisor_conversations_and_recommendati": "Tus conversaciones y recomendaciones anteriores aparecerán aquí.",
			"mark_liked": "Marcar como me gusta",
			"mark_purchased": "Marcar como comprado",
			"mark_skipped": "Marcar como omitido",
			"change_feedback": "Cambiar la valoración"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "Di algo como «ayúdame a encontrar zapatillas de running» o «pronto es el cumpleaños de mi hija»",
			"start_a_conversation_with_your_personal_advisor": "Empieza una conversación con tu asesor personal en cualquier sesión de chat.",
			"start_advisor_conversation": "Hablar con el asesor",
			"start_conversation_failed": "No se pudo iniciar la conversación ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "Tu asesor para los problemas del día a día — primero resuelve, después compra",
			"tab_preferences": "Preferencias",
			"tab_history": "Historial",
			"tab_sites": "Sitios"
		},
		preferencesTab: {
			"add": "Añadir",
			"add_a_preference_e_g_shoe_size_us_10": "Añadir una preferencia (p. ej. «talla de calzado US 10»)",
			"add_group": "Añadir grupo",
			"cancel": "Cancelar",
			"create": "Crear",
			"delete": "Eliminar",
			"delete_group_keeps_preferences": "Eliminar grupo (se conservan las preferencias)",
			"edit": "Editar",
			"group_name": "Nombre del grupo",
			"loading_preferences": "Cargando las preferencias…",
			"no_items_in_this_group": "No hay elementos en este grupo",
			"no_preferences_yet": "Aún no hay preferencias",
			"save": "Guardar",
			"ungrouped": "Sin grupo",
			"assign_to_group": "Asignar a un grupo",
			"no_group": "Sin grupo",
			"delete_named_group": "Eliminar el grupo «{{name}}»",
			"edit_named_preference": "Editar la preferencia «{{text}}»",
			"delete_named_preference": "Eliminar la preferencia «{{text}}»",
			"add_your_first_preference": "Añade una arriba.",
			"the_advisor_cannot_read_this_list_paste_what_ma": "El asesor no puede leer esta lista. Pega en el chat lo que importe cuando preguntes."
		},
		sitesTab: {
			"add_shopping_site": "Añadir tienda",
			"add_site": "Añadir sitio",
			"add_your_shopping_sites_so_the_advisor_can_brows": "Añade las tiendas que quieras tener a mano.",
			"cancel": "Cancelar",
			"how_login_works": "Cómo funciona la investigación",
			"loading_sites": "Cargando los sitios…",
			"no_sites_configured": "No hay sitios configurados",
			"privacy": "Privacidad",
			"remove_site": "Quitar sitio",
			"shopping_sources_the_advisor_can_browse_login_en": "El asesor no puede leer esta lista. Nombra una tienda en el chat y investigará esa: esta es tu propia lista de referencia.",
			"site_name_e_g_example_store": "Nombre del sitio (p. ej. Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "Nada de esto sale de tu equipo.",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "El asesor solo lee páginas públicas de tienda. No puede iniciar sesión ni usar tu sesión, así que los precios y el stock vienen de la página pública.",
			"url_e_g_store_example_com": "URL (p. ej. store.example.com)",
			"remove_named_site": "Quitar {{name}}",
			"save_failed": "No se pudo guardar. Código de error: {{code}}"
		},
		common: { "something_went_wrong": "Algo ha ido mal" }
	},
	fr: {
		manifest: {
			"description": "Un conseiller personnel qui fait des recherches sur de vraies boutiques et aide à résoudre des problèmes qui ne finissent pas forcément par un achat. L'onglet Préférences est votre liste de référence : collez l'essentiel dans le chat. Il n'achète jamais rien : c'est vous qui achetez.",
			"display_name": "Personal Shopper",
			"highlight_1": "Diagnostique le problème avant de recommander quoi que ce soit – parfois la réponse n'est pas un achat",
			"highlight_2": "Collez dans le chat les préférences qui comptent : le conseiller lit vos messages, pas l'onglet Préférences",
			"highlight_3": "Ne consulte que les boutiques que vous nommez, et signale que les prix viennent de pages publiques, pas de votre compte",
			"highlight_4": "Il n'a aucun moyen d'atteindre un panier ou un paiement",
			"highlight_5": "Organisez vos préférences enregistrées en groupes dans l'onglet Préférences",
			"page_label": "Personal Shopper",
			"use_case_1": "Recherche des produits dans les boutiques publiques indiquées tout en gardant le contrôle de la décision, du panier, du compte et du paiement.",
			"configuration_1": "Aucun identifiant de boutique n'est requis ; enregistre éventuellement des Preferences et des Sites pour tes propres références, puis colle les contraintes et noms de boutiques utiles dans la conversation avec le conseiller."
		},
		historyTab: {
			"liked": "Aimé",
			"loading_history": "Chargement de l'historique…",
			"no_history_yet": "Pas encore d'historique",
			"no_products_recommended_advice_was_the_solution": "Aucun produit recommandé — le conseil était la solution",
			"no_sessions_matching": "Aucune session pour « {{query}} »",
			"purchased": "Acheté",
			"search_past_sessions": "Rechercher dans les sessions passées…",
			"skipped": "Ignoré",
			"your_past_advisor_conversations_and_recommendati": "Tes conversations et recommandations passées apparaîtront ici.",
			"mark_liked": "Marquer comme aimé",
			"mark_purchased": "Marquer comme acheté",
			"mark_skipped": "Marquer comme ignoré",
			"change_feedback": "Modifier l'avis"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "Dis quelque chose comme « aide-moi à trouver des chaussures de course » ou « c'est bientôt l'anniversaire de ma fille »",
			"start_a_conversation_with_your_personal_advisor": "Démarre une conversation avec ton conseiller personnel dans n'importe quelle session de chat.",
			"start_advisor_conversation": "Parler au conseiller",
			"start_conversation_failed": "Impossible de démarrer la conversation ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "Ton conseiller pour les problèmes du quotidien — il résout d'abord, il achète ensuite",
			"tab_preferences": "Préférences",
			"tab_history": "Historique",
			"tab_sites": "Sites"
		},
		preferencesTab: {
			"add": "Ajouter",
			"add_a_preference_e_g_shoe_size_us_10": "Ajouter une préférence (par ex. « pointure US 10 »)",
			"add_group": "Ajouter un groupe",
			"cancel": "Annuler",
			"create": "Créer",
			"delete": "Supprimer",
			"delete_group_keeps_preferences": "Supprimer le groupe (les préférences sont conservées)",
			"edit": "Modifier",
			"group_name": "Nom du groupe",
			"loading_preferences": "Chargement des préférences…",
			"no_items_in_this_group": "Aucun élément dans ce groupe",
			"no_preferences_yet": "Pas encore de préférences",
			"save": "Enregistrer",
			"ungrouped": "Sans groupe",
			"assign_to_group": "Affecter à un groupe",
			"no_group": "Aucun groupe",
			"delete_named_group": "Supprimer le groupe « {{name}} »",
			"edit_named_preference": "Modifier la préférence « {{text}} »",
			"delete_named_preference": "Supprimer la préférence « {{text}} »",
			"add_your_first_preference": "Ajoute-en une ci-dessus.",
			"the_advisor_cannot_read_this_list_paste_what_ma": "Le conseiller ne peut pas lire cette liste. Collez l'essentiel dans le chat quand vous posez la question."
		},
		sitesTab: {
			"add_shopping_site": "Ajouter un site marchand",
			"add_site": "Ajouter un site",
			"add_your_shopping_sites_so_the_advisor_can_brows": "Ajoutez les boutiques que vous voulez garder sous la main.",
			"cancel": "Annuler",
			"how_login_works": "Comment fonctionne la recherche",
			"loading_sites": "Chargement des sites…",
			"no_sites_configured": "Aucun site configuré",
			"privacy": "Confidentialité",
			"remove_site": "Retirer le site",
			"shopping_sources_the_advisor_can_browse_login_en": "Le conseiller ne peut pas lire cette liste. Nommez une boutique dans le chat et il consultera celle-là : ceci est votre liste de référence.",
			"site_name_e_g_example_store": "Nom du site (par ex. Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "Rien ne quitte votre machine.",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "Le conseiller ne lit que les pages publiques. Il ne peut pas se connecter ni utiliser votre session : prix et stocks viennent donc de la page publique.",
			"url_e_g_store_example_com": "URL (par ex. store.example.com)",
			"remove_named_site": "Retirer {{name}}",
			"save_failed": "Échec de l'enregistrement. Code d'erreur : {{code}}"
		},
		common: { "something_went_wrong": "Une erreur s'est produite" }
	},
	hi: {
		manifest: {
			"description": "एक निजी सलाहकार जो असली स्टोर की जानकारी जुटाता है और उन समस्याओं को हल करने में मदद करता है जिनका अंत खरीद पर होना ज़रूरी नहीं। पसंद टैब तुम्हारी अपनी सूची है — ज़रूरी बातें चैट में चिपकाओ। यह कभी कुछ नहीं खरीदता — खरीदते तुम हो।",
			"display_name": "Personal Shopper",
			"use_case_1": "निर्णय, cart, account और checkout अपने नियंत्रण में रखते हुए नामित सार्वजनिक स्टोर से उत्पादों की जानकारी जुटाएँ।",
			"configuration_1": "स्टोर credential की आवश्यकता नहीं है; अपने संदर्भ के लिए वैकल्पिक Preferences और Sites सहेजें, फिर ज़रूरी सीमाएँ और स्टोर नाम advisor से बातचीत में चिपकाएँ।",
			"highlight_1": "कुछ सुझाने से पहले समस्या समझता है — कभी-कभी जवाब खरीदना नहीं होता",
			"highlight_2": "ज़रूरी पसंद चैट में चिपकाओ — सलाहकार तुम्हारे संदेश पढ़ता है, पसंद टैब नहीं",
			"highlight_3": "सिर्फ़ उन्हीं स्टोर को देखता है जिनका नाम तुम लेते हो, और बताता है कि दाम सार्वजनिक पेज से हैं, तुम्हारे खाते से नहीं",
			"highlight_4": "कार्ट या चेकआउट तक पहुँचने का इसके पास कोई रास्ता ही नहीं है",
			"highlight_5": "पसंद टैब में अपनी सहेजी हुई पसंद को समूहों में बाँटो",
			"page_label": "Personal Shopper"
		},
		historyTab: {
			"liked": "पसंद",
			"loading_history": "इतिहास लोड हो रहा है…",
			"no_history_yet": "अभी कोई इतिहास नहीं",
			"no_products_recommended_advice_was_the_solution": "कोई उत्पाद नहीं सुझाया — सलाह ही समाधान थी",
			"no_sessions_matching": "“{{query}}” से मेल खाता कोई सत्र नहीं",
			"purchased": "खरीदा",
			"search_past_sessions": "पिछले सत्र खोजो…",
			"skipped": "छोड़ा",
			"your_past_advisor_conversations_and_recommendati": "तुम्हारी पिछली सलाहकार बातचीत और सुझाव यहाँ दिखेंगे।",
			"mark_liked": "पसंद के तौर पर चिह्नित करो",
			"mark_purchased": "खरीदा के तौर पर चिह्नित करो",
			"mark_skipped": "छोड़ा के तौर पर चिह्नित करो",
			"change_feedback": "राय बदलो"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "कुछ ऐसा कहो जैसे “दौड़ने के जूते ढूँढने में मदद करो” या “मेरी बेटी का जन्मदिन आ रहा है”",
			"start_a_conversation_with_your_personal_advisor": "किसी भी चैट सत्र में अपने निजी सलाहकार से बातचीत शुरू करो।",
			"start_advisor_conversation": "सलाहकार से बात करें",
			"start_conversation_failed": "बातचीत शुरू नहीं हो सकी ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "रोज़मर्रा की दिक्कतों का सलाहकार — पहले हल, फिर खरीद",
			"tab_preferences": "पसंद",
			"tab_history": "इतिहास",
			"tab_sites": "साइटें"
		},
		preferencesTab: {
			"add": "जोड़ो",
			"add_a_preference_e_g_shoe_size_us_10": "पसंद जोड़ो (जैसे “जूते का नाप US 10”)",
			"add_group": "समूह जोड़ो",
			"cancel": "रद्द करो",
			"create": "बनाओ",
			"delete": "हटाओ",
			"delete_group_keeps_preferences": "समूह हटाओ (पसंद बनी रहेंगी)",
			"edit": "बदलो",
			"group_name": "समूह का नाम",
			"loading_preferences": "पसंद लोड हो रही हैं…",
			"no_items_in_this_group": "इस समूह में कुछ नहीं",
			"no_preferences_yet": "अभी कोई पसंद नहीं",
			"save": "सहेजो",
			"ungrouped": "बिना समूह",
			"assign_to_group": "समूह में डालो",
			"no_group": "कोई समूह नहीं",
			"delete_named_group": "समूह “{{name}}” हटाओ",
			"edit_named_preference": "पसंद “{{text}}” बदलो",
			"delete_named_preference": "पसंद “{{text}}” हटाओ",
			"add_your_first_preference": "ऊपर से एक जोड़ो।",
			"the_advisor_cannot_read_this_list_paste_what_ma": "सलाहकार यह सूची नहीं पढ़ सकता। पूछते समय ज़रूरी बातें चैट में चिपकाओ।"
		},
		sitesTab: {
			"add_shopping_site": "खरीदारी साइट जोड़ो",
			"add_site": "साइट जोड़ो",
			"add_your_shopping_sites_so_the_advisor_can_brows": "जिन स्टोर पर नज़र रखनी है, उन्हें जोड़ो।",
			"cancel": "रद्द करो",
			"how_login_works": "जानकारी जुटाने का तरीका",
			"loading_sites": "साइटें लोड हो रही हैं…",
			"no_sites_configured": "कोई साइट सेट नहीं",
			"privacy": "निजता",
			"remove_site": "साइट हटाओ",
			"shopping_sources_the_advisor_can_browse_login_en": "सलाहकार यह सूची नहीं पढ़ सकता। चैट में किसी स्टोर का नाम लो, वह उसी को देखेगा — यह तुम्हारी अपनी सूची है।",
			"site_name_e_g_example_store": "साइट का नाम (जैसे Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "यहाँ की जानकारी तुम्हारी मशीन से बाहर नहीं जाती।",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "सलाहकार सिर्फ़ सार्वजनिक स्टोर पेज पढ़ता है। यह लॉगिन नहीं कर सकता और तुम्हारे सत्र का उपयोग नहीं कर सकता, इसलिए दाम और उपलब्धता सार्वजनिक पेज से आते हैं।",
			"url_e_g_store_example_com": "URL (जैसे store.example.com)",
			"remove_named_site": "{{name}} हटाओ",
			"save_failed": "सहेजा नहीं जा सका। एरर कोड: {{code}}"
		},
		common: { "something_went_wrong": "कुछ गलत हो गया" }
	},
	it: {
		manifest: {
			"description": "Un consulente personale che fa ricerche su negozi reali e aiuta a risolvere problemi che non sempre finiscono in un acquisto. La scheda Preferenze è il tuo elenco di riferimento: incolla nella chat ciò che conta. Non compra mai nulla: lo fai tu.",
			"display_name": "Personal Shopper",
			"highlight_1": "Analizza il problema prima di consigliare qualcosa: a volte la risposta non è un acquisto",
			"highlight_2": "Incolla nella chat le preferenze che contano: il consulente legge i tuoi messaggi, non la scheda Preferenze",
			"highlight_3": "Consulta solo i negozi che gli indichi, e segnala che i prezzi vengono da pagine pubbliche, non dal tuo account",
			"highlight_4": "Non ha alcun modo di raggiungere carrello o pagamento",
			"highlight_5": "Organizza le preferenze salvate in gruppi nella scheda Preferenze",
			"page_label": "Personal Shopper",
			"use_case_1": "Cerca prodotti nei negozi pubblici indicati mantenendo sotto il tuo controllo decisione, carrello, account e pagamento.",
			"configuration_1": "Non servono credenziali dei negozi; salva facoltativamente Preferences e Sites come riferimento, quindi incolla i vincoli e i nomi dei negozi pertinenti nella conversazione con il consulente."
		},
		historyTab: {
			"liked": "Mi piace",
			"loading_history": "Caricamento della cronologia…",
			"no_history_yet": "Nessuna cronologia",
			"no_products_recommended_advice_was_the_solution": "Nessun prodotto consigliato — il consiglio era la soluzione",
			"no_sessions_matching": "Nessuna sessione per “{{query}}”",
			"purchased": "Acquistato",
			"search_past_sessions": "Cerca nelle sessioni passate…",
			"skipped": "Ignorato",
			"your_past_advisor_conversations_and_recommendati": "Le tue conversazioni e i consigli passati compaiono qui.",
			"mark_liked": "Segna come mi piace",
			"mark_purchased": "Segna come acquistato",
			"mark_skipped": "Segna come ignorato",
			"change_feedback": "Cambia la valutazione"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "Scrivi qualcosa come “aiutami a trovare scarpe da corsa” o “sta arrivando il compleanno di mia figlia”",
			"start_a_conversation_with_your_personal_advisor": "Avvia una conversazione con il tuo consulente personale in qualsiasi sessione di chat.",
			"start_advisor_conversation": "Parla con il consulente",
			"start_conversation_failed": "Impossibile avviare la conversazione ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "Il tuo consulente per i problemi di ogni giorno — prima risolve, poi compra",
			"tab_preferences": "Preferenze",
			"tab_history": "Cronologia",
			"tab_sites": "Siti"
		},
		preferencesTab: {
			"add": "Aggiungi",
			"add_a_preference_e_g_shoe_size_us_10": "Aggiungi una preferenza (per es. “numero di scarpe US 10”)",
			"add_group": "Aggiungi gruppo",
			"cancel": "Annulla",
			"create": "Crea",
			"delete": "Elimina",
			"delete_group_keeps_preferences": "Elimina il gruppo (le preferenze restano)",
			"edit": "Modifica",
			"group_name": "Nome del gruppo",
			"loading_preferences": "Caricamento delle preferenze…",
			"no_items_in_this_group": "Nessun elemento in questo gruppo",
			"no_preferences_yet": "Ancora nessuna preferenza",
			"save": "Salva",
			"ungrouped": "Senza gruppo",
			"assign_to_group": "Assegna a un gruppo",
			"no_group": "Nessun gruppo",
			"delete_named_group": "Elimina il gruppo “{{name}}”",
			"edit_named_preference": "Modifica la preferenza “{{text}}”",
			"delete_named_preference": "Elimina la preferenza “{{text}}”",
			"add_your_first_preference": "Aggiungine una qui sopra.",
			"the_advisor_cannot_read_this_list_paste_what_ma": "Il consulente non può leggere questo elenco. Incolla nella chat ciò che conta quando chiedi."
		},
		sitesTab: {
			"add_shopping_site": "Aggiungi un negozio",
			"add_site": "Aggiungi sito",
			"add_your_shopping_sites_so_the_advisor_can_brows": "Aggiungi i negozi che vuoi tenere a portata di mano.",
			"cancel": "Annulla",
			"how_login_works": "Come funziona la ricerca",
			"loading_sites": "Caricamento dei siti…",
			"no_sites_configured": "Nessun sito configurato",
			"privacy": "Privacy",
			"remove_site": "Rimuovi sito",
			"shopping_sources_the_advisor_can_browse_login_en": "Il consulente non può leggere questo elenco. Nomina un negozio in chat e consulterà quello: questo è il tuo elenco di riferimento.",
			"site_name_e_g_example_store": "Nome del sito (per es. Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "Nulla di questo lascia il tuo computer.",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "Il consulente legge solo pagine pubbliche. Non può accedere né usare la tua sessione, quindi prezzi e disponibilità vengono dalla pagina pubblica.",
			"url_e_g_store_example_com": "URL (per es. store.example.com)",
			"remove_named_site": "Rimuovi {{name}}",
			"save_failed": "Non è stato possibile salvare. Codice di errore: {{code}}"
		},
		common: { "something_went_wrong": "Si è verificato un problema" }
	},
	ja: {
		manifest: {
			"use_case_1": "指定した公開ストアの商品を調査しながら、意思決定、カート、アカウント、購入手続きを自分で管理します。",
			"configuration_1": "ストアの認証情報は不要です。必要に応じて Preferences と Sites を自分用のメモとして保存し、関連する条件とストア名をアドバイザーとの会話に貼り付けます。",
			"description": "実際のストアを調べ、購入で終わるとは限らない問題の解決を手伝うパーソナルアドバイザーです。「好み」タブはあなた用の参照リストで、大事なものはチャットに貼ってください。購入は一切行いません — 決めるのはあなたです。",
			"display_name": "Personal Shopper",
			"highlight_1": "何かを薦める前に問題を見極めます — 買わないことが答えの場合もあります",
			"highlight_2": "大事な好みはチャットに貼ってください — アドバイザーが読むのはあなたのメッセージで、「好み」タブではありません",
			"highlight_3": "あなたが挙げたストアだけを調べ、価格はアカウント経由ではなく公開ページのものだと明示します",
			"highlight_4": "カートや決済に到達する手段をそもそも持ちません",
			"highlight_5": "保存した好みは「好み」タブでグループに整理できます",
			"page_label": "Personal Shopper"
		},
		historyTab: {
			"liked": "高評価",
			"loading_history": "履歴を読み込んでいます…",
			"no_history_yet": "履歴はまだありません",
			"no_products_recommended_advice_was_the_solution": "商品の推薦はありません — アドバイスが解決策でした",
			"no_sessions_matching": "「{{query}}」に一致するセッションはありません",
			"purchased": "購入済み",
			"search_past_sessions": "過去のセッションを検索…",
			"skipped": "スキップ",
			"your_past_advisor_conversations_and_recommendati": "これまでのアドバイザーとの会話と推薦がここに表示されます。",
			"mark_liked": "高評価にする",
			"mark_purchased": "購入済みにする",
			"mark_skipped": "スキップにする",
			"change_feedback": "評価を変更"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "「ランニングシューズを探して」や「娘の誕生日が近い」のように話しかけてください",
			"start_a_conversation_with_your_personal_advisor": "どのチャットセッションでもパーソナルアドバイザーと会話を始められます。",
			"start_advisor_conversation": "アドバイザーと会話を始める",
			"start_conversation_failed": "会話を開始できませんでした（{{code}}）",
			"your_life_problem_advisor_solves_first_shops_sec": "暮らしの困りごとのアドバイザー — まず解決、それから買い物",
			"tab_preferences": "好み",
			"tab_history": "履歴",
			"tab_sites": "サイト"
		},
		preferencesTab: {
			"add": "追加",
			"add_a_preference_e_g_shoe_size_us_10": "好みを追加（例：「靴のサイズ US 10」）",
			"add_group": "グループを追加",
			"cancel": "キャンセル",
			"create": "作成",
			"delete": "削除",
			"delete_group_keeps_preferences": "グループを削除（好みは残ります）",
			"edit": "編集",
			"group_name": "グループ名",
			"loading_preferences": "好みを読み込んでいます…",
			"no_items_in_this_group": "このグループには項目がありません",
			"no_preferences_yet": "好みはまだありません",
			"save": "保存",
			"ungrouped": "未分類",
			"assign_to_group": "グループに入れる",
			"no_group": "グループなし",
			"delete_named_group": "グループ「{{name}}」を削除",
			"edit_named_preference": "好み「{{text}}」を編集",
			"delete_named_preference": "好み「{{text}}」を削除",
			"add_your_first_preference": "上から追加してください。",
			"the_advisor_cannot_read_this_list_paste_what_ma": "アドバイザーはこの一覧を読めません。尋ねるときに大事なものをチャットに貼ってください。"
		},
		sitesTab: {
			"add_shopping_site": "ショッピングサイトを追加",
			"add_site": "サイトを追加",
			"add_your_shopping_sites_so_the_advisor_can_brows": "気にしておきたいストアを追加してください。",
			"cancel": "キャンセル",
			"how_login_works": "調査のしくみ",
			"loading_sites": "サイトを読み込んでいます…",
			"no_sites_configured": "サイトが未設定です",
			"privacy": "プライバシー",
			"remove_site": "サイトを削除",
			"shopping_sources_the_advisor_can_browse_login_en": "アドバイザーはこの一覧を読めません。チャットでストア名を挙げれば、そのストアを調べます — これはあなた用の参照リストです。",
			"site_name_e_g_example_store": "サイト名（例：Example Store）",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "ここの内容が端末から出ることはありません。",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "アドバイザーが読むのは公開されているストアページだけです。ログインもあなたのセッションの利用もできないため、価格と在庫は公開ページのものです。",
			"url_e_g_store_example_com": "URL（例：store.example.com）",
			"remove_named_site": "「{{name}}」を削除",
			"save_failed": "保存できませんでした。エラーコード：{{code}}"
		},
		common: { "something_went_wrong": "問題が発生しました" }
	},
	ko: {
		manifest: {
			"use_case_1": "지정한 공개 스토어의 제품을 조사하면서 결정, 장바구니, 계정, 결제를 직접 관리합니다.",
			"configuration_1": "스토어 자격 증명은 필요하지 않습니다. 필요하면 Preferences와 Sites를 참고용으로 저장한 다음, 관련 제약 조건과 스토어 이름을 어드바이저 대화에 붙여 넣으세요.",
			"description": "실제 스토어를 조사하고, 구매로 끝나지 않을 수도 있는 문제의 해결을 돕는 개인 어드바이저입니다. 취향 탭은 사용자용 참조 목록이며, 중요한 항목은 채팅에 붙여 주세요. 절대 직접 구매하지 않습니다 — 구매는 사용자가 합니다.",
			"display_name": "Personal Shopper",
			"highlight_1": "무언가를 추천하기 전에 문제를 먼저 진단합니다 — 답이 구매가 아닐 때도 있습니다",
			"highlight_2": "중요한 취향은 채팅에 붙여 주세요 — 어드바이저가 읽는 것은 대화이며 취향 탭이 아닙니다",
			"highlight_3": "사용자가 지목한 스토어만 조사하고, 가격이 계정이 아니라 공개 페이지에서 나온 것임을 알려 줍니다",
			"highlight_4": "장바구니나 결제에 도달할 방법 자체가 없습니다",
			"highlight_5": "저장한 취향은 취향 탭에서 그룹으로 정리할 수 있습니다",
			"page_label": "Personal Shopper"
		},
		historyTab: {
			"liked": "좋아요",
			"loading_history": "기록을 불러오는 중…",
			"no_history_yet": "아직 기록이 없습니다",
			"no_products_recommended_advice_was_the_solution": "추천한 제품 없음 — 조언이 해결책이었습니다",
			"no_sessions_matching": "‘{{query}}’과(와) 일치하는 세션이 없습니다",
			"purchased": "구매 완료",
			"search_past_sessions": "지난 세션 검색…",
			"skipped": "건너뜀",
			"your_past_advisor_conversations_and_recommendati": "지난 어드바이저 대화와 추천이 여기에 표시됩니다.",
			"mark_liked": "좋아요로 표시",
			"mark_purchased": "구매 완료로 표시",
			"mark_skipped": "건너뜀으로 표시",
			"change_feedback": "평가 변경"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "‘러닝화 찾아 줘’ 또는 ‘딸 생일이 다가와’처럼 말해 보세요",
			"start_a_conversation_with_your_personal_advisor": "어떤 채팅 세션에서든 퍼스널 어드바이저와 대화를 시작할 수 있습니다.",
			"start_advisor_conversation": "어드바이저와 대화 시작",
			"start_conversation_failed": "대화를 시작할 수 없습니다 ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "생활 문제 어드바이저 — 해결이 먼저, 쇼핑은 그다음",
			"tab_preferences": "선호 항목",
			"tab_history": "기록",
			"tab_sites": "사이트"
		},
		preferencesTab: {
			"add": "추가",
			"add_a_preference_e_g_shoe_size_us_10": "선호 항목 추가(예: ‘신발 사이즈 US 10’)",
			"add_group": "그룹 추가",
			"cancel": "취소",
			"create": "만들기",
			"delete": "삭제",
			"delete_group_keeps_preferences": "그룹 삭제(선호 항목은 유지)",
			"edit": "편집",
			"group_name": "그룹 이름",
			"loading_preferences": "선호 항목을 불러오는 중…",
			"no_items_in_this_group": "이 그룹에 항목이 없습니다",
			"no_preferences_yet": "아직 선호 항목이 없습니다",
			"save": "저장",
			"ungrouped": "그룹 없음",
			"assign_to_group": "그룹에 넣기",
			"no_group": "그룹 없음",
			"delete_named_group": "‘{{name}}’ 그룹 삭제",
			"edit_named_preference": "‘{{text}}’ 선호 항목 편집",
			"delete_named_preference": "‘{{text}}’ 선호 항목 삭제",
			"add_your_first_preference": "위에서 추가해 보세요.",
			"the_advisor_cannot_read_this_list_paste_what_ma": "어드바이저는 이 목록을 읽을 수 없습니다. 물어볼 때 중요한 항목을 채팅에 붙여 주세요."
		},
		sitesTab: {
			"add_shopping_site": "쇼핑 사이트 추가",
			"add_site": "사이트 추가",
			"add_your_shopping_sites_so_the_advisor_can_brows": "눈여겨보고 싶은 스토어를 추가하세요.",
			"cancel": "취소",
			"how_login_works": "조사 방식",
			"loading_sites": "사이트를 불러오는 중…",
			"no_sites_configured": "설정된 사이트 없음",
			"privacy": "개인 정보",
			"remove_site": "사이트 삭제",
			"shopping_sources_the_advisor_can_browse_login_en": "어드바이저는 이 목록을 읽을 수 없습니다. 채팅에서 스토어 이름을 말하면 그 스토어를 조사합니다 — 이것은 사용자용 참조 목록입니다.",
			"site_name_e_g_example_store": "사이트 이름(예: Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "여기 있는 내용은 기기를 떠나지 않습니다.",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "어드바이저는 공개된 스토어 페이지만 읽습니다. 로그인도, 사용자 세션 사용도 할 수 없으므로 가격과 재고는 공개 페이지 기준입니다.",
			"url_e_g_store_example_com": "URL(예: store.example.com)",
			"remove_named_site": "‘{{name}}’ 삭제",
			"save_failed": "저장하지 못했습니다. 오류 코드: {{code}}"
		},
		common: { "something_went_wrong": "문제가 발생했습니다" }
	},
	pt: {
		manifest: {
			"description": "Um consultor pessoal que pesquisa lojas reais e ajuda a resolver problemas que podem não terminar em uma compra. A aba Preferências é a sua lista de referência — cole no chat o que importa. Ele nunca compra nada: você compra.",
			"display_name": "Personal Shopper",
			"highlight_1": "Diagnostica o problema antes de recomendar algo — às vezes a resposta não é uma compra",
			"highlight_2": "Cole no chat as preferências que importam — o consultor lê suas mensagens, não a aba Preferências",
			"highlight_3": "Pesquisa apenas as lojas que você indicar, e avisa que os preços vêm de páginas públicas, não da sua conta",
			"highlight_4": "Ele não tem como chegar ao carrinho ou ao checkout",
			"highlight_5": "Organize suas preferências salvas em grupos na aba Preferências",
			"page_label": "Personal Shopper",
			"use_case_1": "Pesquise produtos nas lojas públicas indicadas, mantendo decisão, carrinho, conta e checkout sob seu controle.",
			"configuration_1": "Não são necessárias credenciais das lojas; salve opcionalmente Preferences e Sites para sua referência e cole na conversa com o consultor as restrições e os nomes de lojas relevantes."
		},
		historyTab: {
			"liked": "Curti",
			"loading_history": "Carregando o histórico…",
			"no_history_yet": "Ainda sem histórico",
			"no_products_recommended_advice_was_the_solution": "Nenhum produto recomendado — o conselho foi a solução",
			"no_sessions_matching": "Nenhuma sessão correspondente a “{{query}}”",
			"purchased": "Comprado",
			"search_past_sessions": "Buscar sessões anteriores…",
			"skipped": "Ignorado",
			"your_past_advisor_conversations_and_recommendati": "Suas conversas e recomendações anteriores aparecem aqui.",
			"mark_liked": "Marcar como curti",
			"mark_purchased": "Marcar como comprado",
			"mark_skipped": "Marcar como ignorado",
			"change_feedback": "Alterar a avaliação"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "Diga algo como “me ajuda a achar um tênis de corrida” ou “o aniversário da minha filha está chegando”",
			"start_a_conversation_with_your_personal_advisor": "Comece uma conversa com seu consultor pessoal em qualquer sessão de chat.",
			"start_advisor_conversation": "Falar com o consultor",
			"start_conversation_failed": "Não foi possível iniciar a conversa ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "Seu consultor para problemas do dia a dia — resolve primeiro, compra depois",
			"tab_preferences": "Preferências",
			"tab_history": "Histórico",
			"tab_sites": "Sites"
		},
		preferencesTab: {
			"add": "Adicionar",
			"add_a_preference_e_g_shoe_size_us_10": "Adicionar preferência (ex.: “numeração de calçado US 10”)",
			"add_group": "Adicionar grupo",
			"cancel": "Cancelar",
			"create": "Criar",
			"delete": "Excluir",
			"delete_group_keeps_preferences": "Excluir grupo (mantém as preferências)",
			"edit": "Editar",
			"group_name": "Nome do grupo",
			"loading_preferences": "Carregando as preferências…",
			"no_items_in_this_group": "Nenhum item neste grupo",
			"no_preferences_yet": "Ainda sem preferências",
			"save": "Salvar",
			"ungrouped": "Sem grupo",
			"assign_to_group": "Atribuir a um grupo",
			"no_group": "Sem grupo",
			"delete_named_group": "Excluir o grupo “{{name}}”",
			"edit_named_preference": "Editar a preferência “{{text}}”",
			"delete_named_preference": "Excluir a preferência “{{text}}”",
			"add_your_first_preference": "Adicione uma acima.",
			"the_advisor_cannot_read_this_list_paste_what_ma": "O consultor não consegue ler esta lista. Cole no chat o que importa quando perguntar."
		},
		sitesTab: {
			"add_shopping_site": "Adicionar loja",
			"add_site": "Adicionar site",
			"add_your_shopping_sites_so_the_advisor_can_brows": "Adicione as lojas que você quer acompanhar.",
			"cancel": "Cancelar",
			"how_login_works": "Como funciona a pesquisa",
			"loading_sites": "Carregando os sites…",
			"no_sites_configured": "Nenhum site configurado",
			"privacy": "Privacidade",
			"remove_site": "Remover site",
			"shopping_sources_the_advisor_can_browse_login_en": "O consultor não consegue ler esta lista. Cite uma loja no chat e ele pesquisará aquela — esta é a sua lista de referência.",
			"site_name_e_g_example_store": "Nome do site (ex.: Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "Nada disso sai da sua máquina.",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "O consultor lê apenas páginas públicas. Ele não consegue entrar na sua conta nem usar sua sessão, então preços e estoque vêm da página pública.",
			"url_e_g_store_example_com": "URL (ex.: store.example.com)",
			"remove_named_site": "Remover {{name}}",
			"save_failed": "Não foi possível salvar. Código de erro: {{code}}"
		},
		common: { "something_went_wrong": "Algo deu errado" }
	},
	ru: {
		manifest: {
			"description": "Личный советник, который изучает реальные магазины и помогает решать задачи, которые не обязательно заканчиваются покупкой. Вкладка «Предпочтения» — ваш собственный справочный список: вставляйте важное в чат. Он никогда ничего не покупает — покупаете вы.",
			"display_name": "Personal Shopper",
			"use_case_1": "Ищите товары в названных публичных магазинах, сохраняя за собой решение, корзину, учётную запись и оформление покупки.",
			"configuration_1": "Учётные данные магазина не нужны; при желании сохраните Preferences и Sites для себя, затем вставьте подходящие ограничения и названия магазинов в разговор с советником.",
			"highlight_1": "Сначала разбирается в задаче и только потом что-то советует — иногда покупка вовсе не нужна",
			"highlight_2": "Вставляйте в чат важные предпочтения — советник читает ваши сообщения, а не вкладку",
			"highlight_3": "Изучает только те магазины, которые вы назвали, и предупреждает, что цены взяты с общедоступных страниц, а не из вашего аккаунта",
			"highlight_4": "У него нет никакой возможности добраться до корзины или оплаты",
			"highlight_5": "Разложите сохранённые предпочтения по группам на вкладке «Предпочтения»",
			"page_label": "Personal Shopper"
		},
		historyTab: {
			"liked": "Понравилось",
			"loading_history": "Загрузка истории…",
			"no_history_yet": "Истории пока нет",
			"no_products_recommended_advice_was_the_solution": "Товары не рекомендованы — решением стал совет",
			"no_sessions_matching": "Нет сессий по запросу «{{query}}»",
			"purchased": "Куплено",
			"search_past_sessions": "Поиск по прошлым сессиям…",
			"skipped": "Пропущено",
			"your_past_advisor_conversations_and_recommendati": "Твои прошлые разговоры с советником и рекомендации появятся здесь.",
			"mark_liked": "Отметить как понравилось",
			"mark_purchased": "Отметить как куплено",
			"mark_skipped": "Отметить как пропущено",
			"change_feedback": "Изменить оценку"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "Скажи что-нибудь вроде «помоги найти кроссовки для бега» или «у дочки скоро день рождения»",
			"start_a_conversation_with_your_personal_advisor": "Начни разговор со своим личным советником в любой сессии чата.",
			"start_advisor_conversation": "Начать разговор с консультантом",
			"start_conversation_failed": "Не удалось начать разговор ({{code}})",
			"your_life_problem_advisor_solves_first_shops_sec": "Твой советник по бытовым задачам — сначала решает, потом покупает",
			"tab_preferences": "Предпочтения",
			"tab_history": "История",
			"tab_sites": "Сайты"
		},
		preferencesTab: {
			"add": "Добавить",
			"add_a_preference_e_g_shoe_size_us_10": "Добавить предпочтение (например, «размер обуви US 10»)",
			"add_group": "Добавить группу",
			"cancel": "Отмена",
			"create": "Создать",
			"delete": "Удалить",
			"delete_group_keeps_preferences": "Удалить группу (предпочтения останутся)",
			"edit": "Изменить",
			"group_name": "Название группы",
			"loading_preferences": "Загрузка предпочтений…",
			"no_items_in_this_group": "В этой группе ничего нет",
			"no_preferences_yet": "Предпочтений пока нет",
			"save": "Сохранить",
			"ungrouped": "Без группы",
			"assign_to_group": "Добавить в группу",
			"no_group": "Без группы",
			"delete_named_group": "Удалить группу «{{name}}»",
			"edit_named_preference": "Изменить предпочтение «{{text}}»",
			"delete_named_preference": "Удалить предпочтение «{{text}}»",
			"add_your_first_preference": "Добавь одно выше.",
			"the_advisor_cannot_read_this_list_paste_what_ma": "Советник не может прочитать этот список. Вставьте в чат то, что важно, когда спрашиваете."
		},
		sitesTab: {
			"add_shopping_site": "Добавить магазин",
			"add_site": "Добавить сайт",
			"add_your_shopping_sites_so_the_advisor_can_brows": "Добавьте магазины, которые хотите держать под рукой.",
			"cancel": "Отмена",
			"how_login_works": "Как работает поиск",
			"loading_sites": "Загрузка сайтов…",
			"no_sites_configured": "Сайты не настроены",
			"privacy": "Конфиденциальность",
			"remove_site": "Удалить сайт",
			"shopping_sources_the_advisor_can_browse_login_en": "Советник не может прочитать этот список. Назовите магазин в чате, и он изучит именно его — это ваш собственный справочный список.",
			"site_name_e_g_example_store": "Название сайта (например, Example Store)",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "Ничего из этого не покидает ваш компьютер.",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "Советник читает только общедоступные страницы. Он не может войти в аккаунт и не использует вашу сессию, поэтому цены и наличие берутся с общедоступной страницы.",
			"url_e_g_store_example_com": "URL (например, store.example.com)",
			"remove_named_site": "Удалить «{{name}}»",
			"save_failed": "Не удалось сохранить. Код ошибки: {{code}}"
		},
		common: { "something_went_wrong": "Что-то пошло не так" }
	},
	"zh-CN": {
		manifest: {
			"use_case_1": "在指定的公共商店中研究产品，同时由你掌控决策、购物车、账号和结账。",
			"configuration_1": "无需商店凭据；可保存偏好设置和站点供自己参考，然后在顾问对话中粘贴相关限制条件和商店名称。",
			"description": "一位会去查真实商店资料的私人顾问，帮你解决未必以购买收场的问题。“偏好”标签页是你自己的参考清单，要紧的内容请贴进对话。它从不下单——下单的人是你。",
			"display_name": "Personal Shopper",
			"highlight_1": "先诊断问题再推荐——有时答案根本不是买东西",
			"highlight_2": "把要紧的偏好贴进对话——顾问看你的消息，不是“偏好”标签页",
			"highlight_3": "只查你点名的商店，并会说明价格来自公开页面，而不是你登录后看到的价格",
			"highlight_4": "它根本没有办法碰到购物车和结账",
			"highlight_5": "在“偏好”标签页里把存下来的偏好分组",
			"page_label": "Personal Shopper"
		},
		historyTab: {
			"liked": "已点赞",
			"loading_history": "正在加载历史记录…",
			"no_history_yet": "暂无历史记录",
			"no_products_recommended_advice_was_the_solution": "没有推荐商品，建议本身就是答案",
			"no_sessions_matching": "没有匹配“{{query}}”的会话",
			"purchased": "已购买",
			"search_past_sessions": "搜索历史会话…",
			"skipped": "已跳过",
			"your_past_advisor_conversations_and_recommendati": "你与顾问的历史对话和推荐会显示在这里。",
			"mark_liked": "标记为已点赞",
			"mark_purchased": "标记为已购买",
			"mark_skipped": "标记为已跳过",
			"change_feedback": "修改反馈"
		},
		personalShopperPage: {
			"personal_shopper": "Personal Shopper",
			"say_something_like_help_me_find_running_shoes_or": "可以这样说：“帮我找跑鞋”，或者“女儿快过生日了”",
			"start_a_conversation_with_your_personal_advisor": "在任意聊天会话中都能和私人顾问开始对话。",
			"start_advisor_conversation": "开始咨询对话",
			"start_conversation_failed": "无法开始对话（{{code}}）",
			"your_life_problem_advisor_solves_first_shops_sec": "生活问题顾问，先解决，再购物",
			"tab_preferences": "偏好",
			"tab_history": "历史",
			"tab_sites": "网站"
		},
		preferencesTab: {
			"add": "添加",
			"add_a_preference_e_g_shoe_size_us_10": "添加偏好（例如“鞋码 US 10”）",
			"add_group": "添加分组",
			"cancel": "取消",
			"create": "创建",
			"delete": "删除",
			"delete_group_keeps_preferences": "删除分组（保留偏好）",
			"edit": "编辑",
			"group_name": "分组名称",
			"loading_preferences": "正在加载偏好…",
			"no_items_in_this_group": "该分组暂无内容",
			"no_preferences_yet": "暂无偏好",
			"save": "保存",
			"ungrouped": "未分组",
			"assign_to_group": "归入分组",
			"no_group": "不分组",
			"delete_named_group": "删除分组 {{name}}",
			"edit_named_preference": "编辑偏好“{{text}}”",
			"delete_named_preference": "删除偏好“{{text}}”",
			"add_your_first_preference": "在上方添加一条。",
			"the_advisor_cannot_read_this_list_paste_what_ma": "顾问读不到这个清单。你问的时候，把要紧的几条贴进对话。"
		},
		sitesTab: {
			"add_shopping_site": "添加购物网站",
			"add_site": "添加网站",
			"add_your_shopping_sites_so_the_advisor_can_brows": "把你想留意的商店加进来。",
			"cancel": "取消",
			"how_login_works": "查资料的方式",
			"loading_sites": "正在加载网站…",
			"no_sites_configured": "尚未配置网站",
			"privacy": "隐私",
			"remove_site": "移除网站",
			"shopping_sources_the_advisor_can_browse_login_en": "顾问读不到这个清单。你在对话里说出哪家店，它就查那家——这里只是你自己的参考清单。",
			"site_name_e_g_example_store": "网站名称（例如 Example Store）",
			"the_advisor_only_visits_sites_you_ve_enabled_her": "这里的内容不会离开你的机器。",
			"the_advisor_opens_sites_in_the_browser_panel_dur": "顾问只读公开的商店页面。它无法登录，也用不了你的登录状态，所以价格和库存都来自公开页面。",
			"url_e_g_store_example_com": "URL（例如 store.example.com）",
			"remove_named_site": "移除 {{name}}",
			"save_failed": "保存失败。错误代码：{{code}}"
		},
		common: { "something_went_wrong": "出现问题" }
	}
};
var own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
function lookup(catalog, key) {
	let node = catalog;
	for (const part of key.split(".")) {
		if (node === void 0 || typeof node === "string" || !own(node, part)) return void 0;
		node = node[part];
	}
	return typeof node === "string" ? node : void 0;
}
/** The catalogs to try for `locale`, most specific first, always ending in English. */
function localeChain(locale) {
	const chain = [];
	const add = (candidate) => {
		if (own(CATALOGS, candidate) && !chain.includes(candidate)) chain.push(candidate);
	};
	add(locale);
	add(locale.split("-")[0]);
	add("en");
	return chain;
}
function currentLocale() {
	try {
		const locale = activeLocale();
		return typeof locale === "string" && locale ? locale : "en";
	} catch {
		return "en";
	}
}
var PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;
function t(key, vars) {
	for (const locale of localeChain(currentLocale())) {
		const text = lookup(CATALOGS[locale], key);
		if (text !== void 0) return text.replace(PLACEHOLDER, (whole, name) => vars && own(vars, name) ? String(vars[name]) : whole);
	}
	return key;
}
// src/PreferencesTab.tsx
/**
* PreferencesTab — full preference management with user-defined groups.
*
* Two decoupled layers:
* - UI: user organizes with tags/groups (purely for their mental model)
* - AI: retrieves via RAG (ignores group structure, uses embeddings)
*
* CRUD operations hit /api/apps/personal-shopper/* endpoints.
*/
async function fetchPreferences(shopApi) {
	return shopApi.get("/preferences");
}
async function fetchGroups(shopApi) {
	return shopApi.get("/groups");
}
async function addPreference(shopApi, text, tags) {
	return shopApi.post("/preferences", {
		text,
		tags
	});
}
async function updatePreference(shopApi, id, data) {
	await shopApi.put(`/preferences/${id}`, data);
}
async function deletePreference(shopApi, id) {
	await shopApi.del(`/preferences/${id}`);
}
async function addGroup(shopApi, name, icon) {
	return shopApi.post("/groups", {
		name,
		icon
	});
}
async function deleteGroup(shopApi, id) {
	await shopApi.del(`/groups/${id}`);
}
function PreferencesTab() {
	const queryClient = useQueryClient();
	const shopApi = useShopApi();
	const [newPrefText, setNewPrefText] = useState("");
	const [newPrefGroup, setNewPrefGroup] = useState("");
	const [newGroupName, setNewGroupName] = useState("");
	const [showGroupForm, setShowGroupForm] = useState(false);
	const { data: prefsData, isLoading: prefsLoading } = useQuery({
		queryKey: ["personal-shopper", "preferences"],
		queryFn: () => fetchPreferences(shopApi)
	});
	const { data: groupsData } = useQuery({
		queryKey: ["personal-shopper", "groups"],
		queryFn: () => fetchGroups(shopApi)
	});
	const invalidate = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ["personal-shopper"] });
	}, [queryClient]);
	const addPrefMutation = useMutation({
		mutationFn: ({ text, tags }) => addPreference(shopApi, text, tags),
		onSuccess: () => {
			invalidate();
			setNewPrefText("");
		}
	});
	const deletePrefMutation = useMutation({
		mutationFn: (id) => deletePreference(shopApi, id),
		onSuccess: invalidate
	});
	const addGroupMutation = useMutation({
		mutationFn: ({ name, icon }) => addGroup(shopApi, name, icon),
		onSuccess: () => {
			invalidate();
			setNewGroupName("");
			setShowGroupForm(false);
		}
	});
	const deleteGroupMutation = useMutation({
		mutationFn: (id) => deleteGroup(shopApi, id),
		onSuccess: invalidate
	});
	const preferences = prefsData?.preferences ?? [];
	const groups = groupsData?.groups ?? [];
	const groupNames = new Map(groups.map((g) => [g.id, g.name]));
	if (prefsLoading) return /* @__PURE__ */ jsx("div", {
		className: "text-sm text-[var(--muted)] py-8 text-center",
		children: t("preferencesTab.loading_preferences")
	});
	const grouped = /* @__PURE__ */ new Map();
	const ungrouped = [];
	for (const pref of preferences) if (pref.tags.length === 0) ungrouped.push(pref);
	else for (const tag of pref.tags) {
		if (!grouped.has(tag)) grouped.set(tag, []);
		grouped.get(tag).push(pref);
	}
	return /* @__PURE__ */ jsxs("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ jsxs("form", {
				className: "flex gap-2",
				onSubmit: (e) => {
					e.preventDefault();
					if (newPrefText.trim()) addPrefMutation.mutate({
						text: newPrefText.trim(),
						tags: newPrefGroup ? [newPrefGroup] : []
					});
				},
				children: [
					/* @__PURE__ */ jsx(Input, {
						value: newPrefText,
						onChange: (e) => setNewPrefText(e.target.value),
						placeholder: t("preferencesTab.add_a_preference_e_g_shoe_size_us_10"),
						className: "flex-1"
					}),
					groups.length > 0 && /* @__PURE__ */ jsx(Select, {
						options: groups.map((g) => g.id),
						optionLabels: groups.map((g) => g.name),
						value: newPrefGroup,
						onChange: setNewPrefGroup,
						clearLabel: t("preferencesTab.no_group"),
						"aria-label": t("preferencesTab.assign_to_group")
					}),
					/* @__PURE__ */ jsxs(Btn, {
						type: "submit",
						disabled: !newPrefText.trim() || addPrefMutation.isPending,
						children: [
							/* @__PURE__ */ jsx(Plus, { size: 14 }),
							" ",
							t("preferencesTab.add")
						]
					})
				]
			}),
			addPrefMutation.isError ? /* @__PURE__ */ jsx(ErrorNotice, { message: addPrefMutation.error.message }) : null,
			deletePrefMutation.isError ? /* @__PURE__ */ jsx(ErrorNotice, { message: deletePrefMutation.error.message }) : null,
			deleteGroupMutation.isError ? /* @__PURE__ */ jsx(ErrorNotice, { message: deleteGroupMutation.error.message }) : null,
			/* @__PURE__ */ jsx("p", {
				role: "note",
				className: "text-sm px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)] leading-relaxed",
				children: t("preferencesTab.the_advisor_cannot_read_this_list_paste_what_ma")
			}),
			preferences.length === 0 && /* @__PURE__ */ jsx(EmptyState, {
				icon: /* @__PURE__ */ jsx(Tag, { size: 28 }),
				title: t("preferencesTab.no_preferences_yet"),
				subtitle: t("preferencesTab.add_your_first_preference")
			}),
			groups.map((group) => {
				const items = grouped.get(group.id) ?? [];
				return /* @__PURE__ */ jsxs("section", {
					className: "space-y-1",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "flex items-center justify-between",
						children: [/* @__PURE__ */ jsxs("h3", {
							className: "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]",
							children: [/* @__PURE__ */ jsx(Folder, { size: 12 }), group.name]
						}), /* @__PURE__ */ jsx("button", {
							onClick: () => deleteGroupMutation.mutate(group.id),
							className: "text-[var(--muted)] hover:text-[var(--danger)] transition-colors",
							title: t("preferencesTab.delete_group_keeps_preferences"),
							"aria-label": t("preferencesTab.delete_named_group", { name: group.name }),
							...caution,
							children: /* @__PURE__ */ jsx(X, { size: 12 })
						})]
					}), items.length === 0 ? /* @__PURE__ */ jsx("p", {
						className: "text-[11px] text-[var(--muted)] italic pl-2",
						children: t("preferencesTab.no_items_in_this_group")
					}) : /* @__PURE__ */ jsx("div", {
						className: "space-y-1",
						children: items.map((p) => /* @__PURE__ */ jsx(PreferenceRow, {
							pref: p,
							onDelete: () => deletePrefMutation.mutate(p.id),
							onUpdate: invalidate,
							groupNames,
							groups,
							sectionGroupId: group.id
						}, p.id))
					})]
				}, group.id);
			}),
			ungrouped.length > 0 && /* @__PURE__ */ jsxs("section", {
				className: "space-y-1",
				children: [/* @__PURE__ */ jsx("h3", {
					className: "text-xs font-semibold uppercase tracking-wide text-[var(--muted)]",
					children: t("preferencesTab.ungrouped")
				}), /* @__PURE__ */ jsx("div", {
					className: "space-y-1",
					children: ungrouped.map((p) => /* @__PURE__ */ jsx(PreferenceRow, {
						pref: p,
						onDelete: () => deletePrefMutation.mutate(p.id),
						onUpdate: invalidate,
						groupNames,
						groups
					}, p.id))
				})]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "pt-2 border-t border-[var(--border)]",
				children: [addGroupMutation.isError ? /* @__PURE__ */ jsx(ErrorNotice, {
					className: "mb-2",
					message: addGroupMutation.error.message
				}) : null, showGroupForm ? /* @__PURE__ */ jsxs("form", {
					className: "flex gap-2",
					onSubmit: (e) => {
						e.preventDefault();
						if (newGroupName.trim()) addGroupMutation.mutate({
							name: newGroupName.trim(),
							icon: ""
						});
					},
					children: [
						/* @__PURE__ */ jsx(Input, {
							value: newGroupName,
							onChange: (e) => setNewGroupName(e.target.value),
							placeholder: t("preferencesTab.group_name"),
							className: "flex-1",
							autoFocus: true
						}),
						/* @__PURE__ */ jsx(Btn, {
							type: "submit",
							disabled: !newGroupName.trim(),
							children: t("preferencesTab.create")
						}),
						/* @__PURE__ */ jsx(Btn, {
							type: "button",
							onClick: () => setShowGroupForm(false),
							children: t("preferencesTab.cancel")
						})
					]
				}) : /* @__PURE__ */ jsxs("button", {
					onClick: () => setShowGroupForm(true),
					className: "flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors",
					children: [
						/* @__PURE__ */ jsx(FolderPlus, { size: 14 }),
						" ",
						t("preferencesTab.add_group")
					]
				})]
			})
		]
	});
}
/**
* The tag a row's selector represents: the group section it is rendered under.
*
* A multi-group preference is rendered once per group it belongs to, so the
* row's identity is its SECTION, not `tags[0]`. Seeding from `tags[0]` made the
* editor under heading "B" open preselected to "A" and edit a membership the
* user could not see.
*/
function rowTagFor(prefTags, sectionGroupId) {
	return sectionGroupId ?? prefTags[0] ?? "";
}
/**
* Tags to PUT when a row's group selector moves from `openedWith` to `editGroup`.
*
* Rules, each one a defect this replaced:
* - Replace `openedWith` IN PLACE and keep every other tag. The store treats the
*   array as authoritative, so omitting a tag deletes that membership.
* - An empty `editGroup` removes only this row's membership.
* - Deduplicate: the user can pick a group the preference already belongs to,
*   which would otherwise persist a duplicate tag and render duplicate-key rows.
* - `openedWith === ''` means the row was ungrouped, so the pick is an addition.
*/
function nextTagsForRowEdit(prefTags, openedWith, editGroup) {
	const next = openedWith ? prefTags.flatMap((t) => t === openedWith ? editGroup ? [editGroup] : [] : [t]) : editGroup ? [...prefTags, editGroup] : [...prefTags];
	return Array.from(new Set(next));
}
function PreferenceRow({ pref, onDelete, onUpdate, groupNames, groups, sectionGroupId }) {
	const shopApi = useShopApi();
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState(pref.text);
	const rowTag = rowTagFor(pref.tags, sectionGroupId);
	const [editGroup, setEditGroup] = useState(rowTag);
	const [openedWith, setOpenedWith] = useState(rowTag);
	const canReassign = pref.tags.length <= 1;
	const startEditing = () => {
		setEditText(pref.text);
		setEditGroup(rowTag);
		setOpenedWith(rowTag);
		setEditing(true);
	};
	const updateMutation = useMutation({
		mutationFn: (data) => updatePreference(shopApi, pref.id, data),
		onSuccess: () => {
			setEditing(false);
			onUpdate();
		}
	});
	if (editing) {
		const nextTags = nextTagsForRowEdit(pref.tags, openedWith, editGroup);
		const textChanged = editText.trim() !== pref.text;
		const groupChanged = canReassign && editGroup !== openedWith;
		const changed = textChanged || groupChanged;
		return /* @__PURE__ */ jsxs("div", {
			className: "space-y-1",
			children: [/* @__PURE__ */ jsxs("form", {
				className: "flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--accent)]",
				onSubmit: (e) => {
					e.preventDefault();
					if (editText.trim() && changed) updateMutation.mutate(groupChanged ? {
						text: editText.trim(),
						tags: nextTags
					} : { text: editText.trim() });
					else setEditing(false);
				},
				children: [
					/* @__PURE__ */ jsx("input", {
						value: editText,
						onChange: (e) => setEditText(e.target.value),
						"aria-label": t("preferencesTab.edit_named_preference", { text: pref.text }),
						className: "flex-1 text-sm bg-transparent text-[var(--text)]",
						autoFocus: true,
						onKeyDown: (e) => {
							if (e.key === "Escape") setEditing(false);
						}
					}),
					canReassign && groups.length > 0 && /* @__PURE__ */ jsx(Select, {
						options: groups.map((g) => g.id),
						optionLabels: groups.map((g) => g.name),
						value: editGroup,
						onChange: setEditGroup,
						clearLabel: t("preferencesTab.no_group"),
						"aria-label": t("preferencesTab.assign_to_group")
					}),
					/* @__PURE__ */ jsx(Btn, {
						type: "submit",
						disabled: !editText.trim() || !changed,
						children: t("preferencesTab.save")
					}),
					/* @__PURE__ */ jsx("button", {
						type: "button",
						onClick: () => setEditing(false),
						className: "text-[var(--muted)]",
						title: t("preferencesTab.cancel"),
						"aria-label": t("preferencesTab.cancel"),
						children: /* @__PURE__ */ jsx(X, { size: 14 })
					})
				]
			}), updateMutation.isError ? /* @__PURE__ */ jsx(ErrorNotice, { message: updateMutation.error.message }) : null]
		});
	}
	return /* @__PURE__ */ jsxs("div", {
		className: "group flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--card)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors",
		children: [
			/* @__PURE__ */ jsx("span", {
				className: "flex-1 text-sm text-[var(--text)]",
				children: pref.text
			}),
			pref.tags.filter((t) => t !== sectionGroupId).map((t) => /* @__PURE__ */ jsx("span", {
				className: "text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--muted)]",
				children: groupNames.get(t) ?? t
			}, t)),
			/* @__PURE__ */ jsxs("div", {
				className: "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 flex gap-1 transition-opacity",
				children: [/* @__PURE__ */ jsx("button", {
					onClick: startEditing,
					className: "text-[var(--muted)] hover:text-[var(--accent)]",
					title: t("preferencesTab.edit"),
					"aria-label": t("preferencesTab.edit_named_preference", { text: pref.text }),
					children: /* @__PURE__ */ jsx(Pencil, { size: 12 })
				}), /* @__PURE__ */ jsx("button", {
					onClick: onDelete,
					className: "text-[var(--muted)] hover:text-[var(--danger)]",
					title: t("preferencesTab.delete"),
					"aria-label": t("preferencesTab.delete_named_preference", { text: pref.text }),
					...caution,
					children: /* @__PURE__ */ jsx(Trash2, { size: 12 })
				})]
			})
		]
	});
}
// src/HistoryTab.tsx
/**
* HistoryTab — past advisor sessions with feedback and search.
*
* Shows a timeline of conversations: problem → advice → products → feedback.
* Search uses the RAG endpoint to find relevant past sessions.
* Users can update feedback (liked/purchased/skipped) on products.
*/
async function fetchHistory(shopApi, limit = 20) {
	return shopApi.get(`/history?limit=${limit}`);
}
async function updateFeedback(shopApi, historyId, product, feedback) {
	await shopApi.put(`/history/${historyId}/feedback`, {
		product,
		feedback
	});
}
function HistoryTab() {
	const queryClient = useQueryClient();
	const shopApi = useShopApi();
	const [searchQuery, setSearchQuery] = useState("");
	const { data, isLoading } = useQuery({
		queryKey: ["personal-shopper", "history"],
		queryFn: () => fetchHistory(shopApi)
	});
	const feedbackMutation = useMutation({
		mutationFn: ({ historyId, product, feedback }) => updateFeedback(shopApi, historyId, product, feedback),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-shopper", "history"] })
	});
	const sessions = data?.sessions ?? [];
	const filtered = searchQuery.trim() ? sessions.filter((s) => s.problem.toLowerCase().includes(searchQuery.toLowerCase()) || s.advice.toLowerCase().includes(searchQuery.toLowerCase()) || s.products.some((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))) : sessions;
	if (isLoading) return /* @__PURE__ */ jsx("div", {
		className: "text-sm text-[var(--muted)] py-8 text-center",
		children: t("historyTab.loading_history")
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "space-y-3",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "relative",
				children: [/* @__PURE__ */ jsx(Search, {
					size: 14,
					className: "absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
				}), /* @__PURE__ */ jsx(Input, {
					value: searchQuery,
					onChange: (e) => setSearchQuery(e.target.value),
					placeholder: t("historyTab.search_past_sessions"),
					className: "pl-8"
				})]
			}),
			sessions.length === 0 && /* @__PURE__ */ jsx(EmptyState, {
				icon: /* @__PURE__ */ jsx(Clock, { size: 28 }),
				title: t("historyTab.no_history_yet"),
				subtitle: t("historyTab.your_past_advisor_conversations_and_recommendati")
			}),
			sessions.length > 0 && filtered.length === 0 && /* @__PURE__ */ jsx("p", {
				className: "text-sm text-[var(--muted)] py-4 text-center",
				children: t("historyTab.no_sessions_matching", { query: searchQuery })
			}),
			feedbackMutation.isError ? /* @__PURE__ */ jsx(ErrorNotice, {
				message: feedbackMutation.error.message,
				askAgent: true
			}) : null,
			filtered.map((session) => /* @__PURE__ */ jsx(SessionCard, {
				session,
				onFeedback: (product, feedback) => feedbackMutation.mutate({
					historyId: session.id,
					product,
					feedback
				})
			}, session.id))
		]
	});
}
function SessionCard({ session, onFeedback }) {
	return /* @__PURE__ */ jsxs("div", {
		className: "p-4 rounded-lg bg-[var(--card)] border border-[var(--border)]",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "flex justify-between items-start mb-2",
				children: [/* @__PURE__ */ jsx("h3", {
					className: "text-sm font-medium text-[var(--text)]",
					children: session.problem
				}), /* @__PURE__ */ jsx("span", {
					className: "text-[10px] text-[var(--muted)] whitespace-nowrap ml-2",
					children: session.date
				})]
			}),
			session.advice && /* @__PURE__ */ jsx("p", {
				className: "text-xs text-[var(--muted)] mb-3 pl-2 border-l-2 border-[var(--border)] leading-relaxed",
				children: session.advice
			}),
			session.products.length > 0 && /* @__PURE__ */ jsx("div", {
				className: "space-y-1.5 mt-2",
				children: session.products.map((product, i) => /* @__PURE__ */ jsx(ProductRow, {
					name: product.name,
					price: product.price,
					feedback: session.feedback[product.name],
					onFeedback: (fb) => onFeedback(product.name, fb)
				}, i))
			}),
			session.products.length === 0 && session.advice && /* @__PURE__ */ jsxs("div", {
				className: "flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted)] mt-2 px-2 py-2 rounded bg-[var(--bg-elevated)]",
				children: [/* @__PURE__ */ jsx(Lightbulb, { size: 12 }), t("historyTab.no_products_recommended_advice_was_the_solution")]
			})
		]
	});
}
function ProductRow({ name, price, feedback, onFeedback }) {
	const [editing, setEditing] = useState(false);
	const showChoices = !feedback || editing;
	return /* @__PURE__ */ jsxs("div", {
		className: "flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-[var(--bg-elevated)]",
		children: [
			/* @__PURE__ */ jsx("span", {
				className: "flex-1 text-[var(--text)] font-medium",
				children: name
			}),
			price != null && /* @__PURE__ */ jsx("span", {
				className: "text-[var(--accent)] font-semibold",
				children: fmtCurrency(price)
			}),
			!showChoices ? /* @__PURE__ */ jsx(FeedbackBadge, {
				feedback,
				onEdit: () => setEditing(true)
			}) : /* @__PURE__ */ jsxs("div", {
				className: "flex gap-1",
				children: [
					/* @__PURE__ */ jsx("button", {
						onClick: () => {
							onFeedback("liked");
							setEditing(false);
						},
						className: "p-1 rounded hover:bg-[var(--ok-subtle)] text-[var(--muted)] hover:text-[var(--ok)] transition-colors",
						title: t("historyTab.liked"),
						"aria-label": t("historyTab.mark_liked"),
						children: /* @__PURE__ */ jsx(ThumbsUp, { size: 12 })
					}),
					/* @__PURE__ */ jsx("button", {
						onClick: () => {
							onFeedback("purchased");
							setEditing(false);
						},
						className: "p-1 rounded hover:bg-[var(--accent-subtle)] text-[var(--muted)] hover:text-[var(--accent)] transition-colors",
						title: t("historyTab.purchased"),
						"aria-label": t("historyTab.mark_purchased"),
						children: /* @__PURE__ */ jsx(ShoppingCart, { size: 12 })
					}),
					/* @__PURE__ */ jsx("button", {
						onClick: () => {
							onFeedback("skipped");
							setEditing(false);
						},
						className: "p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--muted)] transition-colors",
						title: t("historyTab.skipped"),
						"aria-label": t("historyTab.mark_skipped"),
						children: /* @__PURE__ */ jsx(SkipForward, { size: 12 })
					})
				]
			})
		]
	});
}
function FeedbackBadge({ feedback, onEdit }) {
	const config = {
		purchased: {
			labelKey: "historyTab.purchased",
			icon: ShoppingCart,
			className: "bg-[var(--accent-subtle)] text-[var(--accent)]"
		},
		liked: {
			labelKey: "historyTab.liked",
			icon: ThumbsUp,
			className: "bg-[var(--ok-subtle)] text-[var(--ok)]"
		},
		skipped: {
			labelKey: "historyTab.skipped",
			icon: SkipForward,
			className: "bg-[var(--bg-elevated)] text-[var(--muted)]"
		}
	};
	const c = config[feedback] ?? config.skipped;
	const Icon = c.icon;
	const label = t(c.labelKey);
	return /* @__PURE__ */ jsxs("button", {
		type: "button",
		onClick: onEdit,
		title: t("historyTab.change_feedback"),
		"aria-label": t("historyTab.change_feedback"),
		className: `inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium transition-opacity hover:opacity-80 ${c.className}`,
		children: [/* @__PURE__ */ jsx(Icon, { size: 10 }), label]
	});
}
// src/SitesTab.tsx
/**
* SitesTab — configured shopping sources with login state management.
*
* Sites are stored in a simple JSON file (not the sqlite store) since they're
* few, rarely change, and don't need vector search.
*/
async function fetchSites(shopApi) {
	return shopApi.get("/sites");
}
async function saveSites(shopApi, data) {
	await shopApi.put("/sites", data);
}
function SitesTab() {
	const ime = useImeGuard();
	const queryClient = useQueryClient();
	const shopApi = useShopApi();
	const [showAddForm, setShowAddForm] = useState(false);
	const [newName, setNewName] = useState("");
	const [newUrl, setNewUrl] = useState("");
	const [errorCode, setErrorCode] = useState(null);
	const { data, isLoading } = useQuery({
		queryKey: ["personal-shopper", "sites"],
		queryFn: () => fetchSites(shopApi),
		staleTime: 3e4
	});
	const mutation = useMutation({
		mutationFn: (next) => saveSites(shopApi, next),
		onMutate: () => setErrorCode(null),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-shopper", "sites"] }),
		onError: (err) => setErrorCode(err instanceof Error ? err.message : "unknown")
	});
	const sites = data?.sites ?? [];
	const busy = mutation.isPending;
	const removeSite = (id) => {
		if (busy) return;
		const updated = sites.filter((s) => s.id !== id);
		mutation.mutate({ sites: updated });
	};
	const addSite = () => {
		if (busy) return;
		if (!newName.trim() || !newUrl.trim()) return;
		const id = crypto.randomUUID();
		const url = newUrl.trim().startsWith("http") ? newUrl.trim() : `https://${newUrl.trim()}`;
		const newSite = {
			id,
			name: newName.trim(),
			url,
			enabled: true,
			loggedIn: false
		};
		mutation.mutate({ sites: [...sites, newSite] }, { onSuccess: () => {
			setNewName("");
			setNewUrl("");
			setShowAddForm(false);
		} });
	};
	if (isLoading) return /* @__PURE__ */ jsx("div", {
		className: "text-sm text-[var(--muted)] py-8 text-center",
		children: t("sitesTab.loading_sites")
	});
	return /* @__PURE__ */ jsxs("div", {
		className: "space-y-3",
		children: [
			/* @__PURE__ */ jsx("p", {
				role: "note",
				className: "text-sm px-3 py-2 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)] leading-relaxed",
				children: t("sitesTab.shopping_sources_the_advisor_can_browse_login_en")
			}),
			/* @__PURE__ */ jsx(ErrorNotice, {
				message: errorCode ? t("sitesTab.save_failed", { code: errorCode }) : null,
				askAgent: !newName && !newUrl
			}),
			sites.length === 0 && !showAddForm && /* @__PURE__ */ jsx(EmptyState, {
				icon: /* @__PURE__ */ jsx(Globe, { size: 28 }),
				title: t("sitesTab.no_sites_configured"),
				subtitle: t("sitesTab.add_your_shopping_sites_so_the_advisor_can_brows")
			}),
			sites.map((site) => /* @__PURE__ */ jsxs("div", {
				className: "group flex items-center gap-3 p-3 rounded-lg bg-[var(--card)] border border-[var(--border)]",
				children: [
					/* @__PURE__ */ jsx("div", {
						className: "w-9 h-9 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] flex items-center justify-center text-base flex-shrink-0",
						children: /* @__PURE__ */ jsx(Globe, {
							size: 16,
							className: "text-[var(--muted)]"
						})
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex-1 min-w-0",
						children: [/* @__PURE__ */ jsx("div", {
							className: "text-sm font-medium text-[var(--text)]",
							children: site.name
						}), /* @__PURE__ */ jsx("div", {
							className: "text-[11px] text-[var(--muted)] truncate",
							children: site.url
						})]
					}),
					/* @__PURE__ */ jsx("button", {
						onClick: () => removeSite(site.id),
						disabled: busy,
						className: "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100 text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-30 [@media(hover:none)]:disabled:opacity-30 transition-all flex-shrink-0",
						title: t("sitesTab.remove_site"),
						"aria-label": t("sitesTab.remove_named_site", { name: site.name }),
						children: /* @__PURE__ */ jsx(Trash2, { size: 14 })
					})
				]
			}, site.id)),
			showAddForm ? /* @__PURE__ */ jsxs("div", {
				className: "p-3 rounded-lg bg-[var(--card)] border border-[var(--accent)] space-y-2",
				children: [
					/* @__PURE__ */ jsx(Input, {
						value: newName,
						onChange: (e) => setNewName(e.target.value),
						placeholder: t("sitesTab.site_name_e_g_example_store"),
						autoFocus: true
					}),
					/* @__PURE__ */ jsx(Input, {
						value: newUrl,
						onChange: (e) => setNewUrl(e.target.value),
						placeholder: t("sitesTab.url_e_g_store_example_com"),
						...ime.bindEnter({ onEnter: addSite })
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex gap-2",
						children: [/* @__PURE__ */ jsx(Btn, {
							onClick: addSite,
							disabled: !newName.trim() || !newUrl.trim(),
							children: t("sitesTab.add_site")
						}), /* @__PURE__ */ jsx(Btn, {
							onClick: () => {
								setShowAddForm(false);
								setNewName("");
								setNewUrl("");
							},
							children: t("sitesTab.cancel")
						})]
					})
				]
			}) : /* @__PURE__ */ jsxs("button", {
				onClick: () => setShowAddForm(true),
				className: "flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors",
				children: [
					/* @__PURE__ */ jsx(Plus, { size: 14 }),
					" ",
					t("sitesTab.add_shopping_site")
				]
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "text-[11px] text-[var(--muted)] mt-4 p-3 rounded-lg bg-[var(--bg-elevated)] leading-relaxed space-y-2",
				children: [/* @__PURE__ */ jsxs("p", { children: [
					/* @__PURE__ */ jsx("strong", { children: t("sitesTab.how_login_works") }),
					" ",
					t("sitesTab.the_advisor_opens_sites_in_the_browser_panel_dur")
				] }), /* @__PURE__ */ jsxs("p", { children: [
					/* @__PURE__ */ jsx("strong", { children: t("sitesTab.privacy") }),
					" ",
					t("sitesTab.the_advisor_only_visits_sites_you_ve_enabled_her")
				] })]
			})
		]
	});
}
// src/PersonalShopperPage.tsx
/**
* PersonalShopperPage — management panel for the Personal Shopper advisor.
*
* Three tabs: Preferences, History, Sites. Chat lives in the main chat
* surface — the "Start conversation" button opens a new session pinned to
* the personal-shopper-advisor agent through the host's chat launcher.
*/
var SEGMENTS = [
	{
		key: "preferences",
		labelKey: "personalShopperPage.tab_preferences"
	},
	{
		key: "history",
		labelKey: "personalShopperPage.tab_history"
	},
	{
		key: "sites",
		labelKey: "personalShopperPage.tab_sites"
	}
];
/**
* The advisor's session contract. App-owned workstreams choose their memory
* contract explicitly, so a general chat preference must not silently alter
* their behaviour: persistent memory, and no per-chat session folder. Both are
* honoured only for a NEW session (no `slotKey`), which is what this opens. A
* host older than App Kit level 1 ignores them and opens a plain new chat with
* the agent selected.
*/
var ADVISOR_LAUNCH = {
	agent: "personal-shopper-advisor",
	memoryMode: "persistent",
	sessionFolder: false
};
function PersonalShopperPage() {
	const [activeTab, setActiveTab] = useState("preferences");
	const [createError, setCreateError] = useState(null);
	const { openChat } = useChatLauncher();
	const startAdvisorSession = useCallback(() => {
		setCreateError(null);
		try {
			openChat(ADVISOR_LAUNCH);
		} catch (e) {
			setCreateError(e instanceof Error && e.message || t("common.something_went_wrong"));
		}
	}, [openChat]);
	return /* @__PURE__ */ jsxs("div", {
		className: "flex flex-col h-full",
		children: [
			/* @__PURE__ */ jsx(PageHeader, {
				title: t("personalShopperPage.personal_shopper"),
				subtitle: t("personalShopperPage.your_life_problem_advisor_solves_first_shops_sec")
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "mx-4 mb-4 p-4 rounded-xl bg-[var(--card)] border border-[var(--border)] flex items-center gap-4",
				children: [
					/* @__PURE__ */ jsx("div", {
						className: "w-10 h-10 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center flex-shrink-0",
						children: /* @__PURE__ */ jsx(ShoppingBag, {
							size: 20,
							className: "text-[var(--accent)]"
						})
					}),
					/* @__PURE__ */ jsxs("div", {
						className: "flex-1 min-w-0",
						children: [
							/* @__PURE__ */ jsx("p", {
								className: "text-sm font-medium text-[var(--text)]",
								children: t("personalShopperPage.start_a_conversation_with_your_personal_advisor")
							}),
							/* @__PURE__ */ jsx("p", {
								className: "text-xs text-[var(--muted)] mt-0.5",
								children: t("personalShopperPage.say_something_like_help_me_find_running_shoes_or")
							}),
							/* @__PURE__ */ jsx(ErrorNotice, {
								className: "mt-1",
								message: createError ? t("personalShopperPage.start_conversation_failed", { code: createError }) : null,
								askAgent: activeTab === "history"
							})
						]
					}),
					/* @__PURE__ */ jsxs(Btn, {
						onClick: startAdvisorSession,
						primary: true,
						children: [/* @__PURE__ */ jsx(MessageCirclePlus, { size: 14 }), t("personalShopperPage.start_advisor_conversation")]
					})
				]
			}),
			/* @__PURE__ */ jsx("div", {
				className: "px-4 pb-2",
				children: /* @__PURE__ */ jsx(SegmentedControl, {
					value: activeTab,
					onChange: (v) => setActiveTab(v),
					segments: SEGMENTS.map((s) => ({
						key: s.key,
						label: t(s.labelKey)
					}))
				})
			}),
			/* @__PURE__ */ jsxs("div", {
				className: "flex-1 overflow-y-auto px-4 pb-4",
				children: [
					activeTab === "preferences" && /* @__PURE__ */ jsx(PreferencesTab, {}),
					activeTab === "history" && /* @__PURE__ */ jsx(HistoryTab, {}),
					activeTab === "sites" && /* @__PURE__ */ jsx(SitesTab, {})
				]
			})
		]
	});
}
// src/index.tsx
/**
* The bundle's entry: AppHost lazy-imports this module and renders its default
* export as the app's page.
*
* Subscribing to the host's language generation here is what repaints the page
* on a language switch: `t` reads the active locale at call time, and this
* component's re-render reaches every child.
*/
function PersonalShopperApp() {
	useLanguageGeneration();
	return /* @__PURE__ */ jsx(PersonalShopperPage, {});
}
export { PersonalShopperApp as default };
