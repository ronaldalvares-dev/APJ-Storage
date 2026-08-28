// ==UserScript==
// @name         APJ Storage Wolken Prompt Tracker
// @namespace    http://tampermonkey.net/
// @version      1.2
// @match        *://*.wolkenservicedesk.com/*
// @match        *://broadcomcms-software-agent.wolkenservicedesk.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://raw.githubusercontent.com/ronaldalvares-dev/APJ-Storage/main/wolken-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/ronaldalvares-dev/APJ-Storage/main/wolken-tracker.user.js
// ==/UserScript==

(function() {
    'use strict';

    const WEBHOOK_URL = "https://script.google.com/a/macros/broadcom.com/s/AKfycbwgDWvnJE83pyRWZCFZlFunzlT2XxoT5lQxzw8_gKQ-PEcAH2kSuyOBfYJBp_z8eM_D/exec";

    // ADD YOUR PROMPTS HERE: "data-prompt-id": "Human Readable Name for Google Sheet"
    const TRACKED_PROMPTS = {
        "shared_kcs_case_owner_responsibilities": "KCS Case Owner Responsibilities",
        "shared_neo_resolution_summary_evaluator": "Neo Resolution Summary Evaluator",
        "shared_process_sentinel": "Process Sentinel"
    };

    let lastSentTime = 0;

    function getLoggedInUser() {
        try {
            const chatElement = document.querySelector('wolken-ai-chat');
            if (chatElement && chatElement.hasAttribute('user')) {
                const userJSON = JSON.parse(chatElement.getAttribute('user'));
                if (userJSON && userJSON.name) {
                    return userJSON.name.trim();
                }
            }
        } catch (e) {}

        try {
            for (let i = 0; i < localStorage.length; i++) {
                let key = localStorage.key(i);
                if (key.toLowerCase().includes('user') || key.toLowerCase().includes('profile')) {
                    let val = localStorage.getItem(key);
                    let parsed = JSON.parse(val);
                    if (parsed && (parsed.name || parsed.userName)) {
                        let foundName = parsed.name || parsed.userName;
                        if (foundName.includes("@")) foundName = foundName.split('@')[0].replace('.', ' ');
                        if (foundName.length > 2) return foundName;
                    }
                }
            }
        } catch(e) {}

        return "Unknown TSE";
    }

    function cleanCaseId(rawId) {
        if (!rawId || rawId === "Not Found") return "Not Found";
        let cleaned = rawId.replace(/[^\d]/g, '').trim();
        return cleaned.length > 0 ? cleaned : rawId;
    }

    function isElementVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0) return false;

        if (rect.right < 0 || rect.left > window.innerWidth || rect.bottom < 0 || rect.top > window.innerHeight) {
            return false;
        }

        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }

        return true;
    }

    function scrapePage() {
        let data = { caseId: "Not Found", createdOn: "Not Found", caseOwner: "Not Found", status: "Not Found" };

        try {
            const keyContainers = document.querySelectorAll('.section-fields-keys-ca');

            for (let i = 0; i < keyContainers.length; i++) {
                let keyEl = keyContainers[i];

                if (!isElementVisible(keyEl)) continue;

                let keyText = keyEl.innerText.trim();

                let parentRow = keyEl.closest('[data-wtt-field-id]') || keyEl.parentElement.parentElement;
                let valueEl = parentRow ? parentRow.querySelector('.section-fields-values-ca') : null;

                if (valueEl) {
                    let clone = valueEl.cloneNode(true);
                    let noiseElements = clone.querySelectorAll('.wtt-icon, .wtt-copy-button, mat-icon');
                    noiseElements.forEach(noise => noise.remove());

                    let valueText = (clone.innerText || clone.textContent || "").trim();

                    if (valueText) {
                        valueText = valueText.split('\n')[0].trim();

                        if (keyText.includes("Case Number") && data.caseId === "Not Found") data.caseId = valueText;
                        if (keyText.includes("Date/Time Created") && data.createdOn === "Not Found") data.createdOn = valueText;
                        if (keyText.includes("Case Owner") && data.caseOwner === "Not Found") data.caseOwner = valueText;
                        if (keyText.includes("Status/Substatus") && data.status === "Not Found") data.status = valueText;
                    }
                }
            }

            if (data.caseId === "Not Found") {
                let urlMatch = window.location.href.match(/(\d{7,10})/);
                if (urlMatch) data.caseId = urlMatch[1];
            }

            if (data.status === "Not Found" || data.caseOwner === "Not Found") {
                const allElements = document.querySelectorAll('span, div, label');
                for (let el of allElements) {
                    if (!isElementVisible(el)) continue;
                    let text = el.innerText.trim();

                    if (data.status === "Not Found" && text.startsWith("Status/Substatus:") && text.length > 17) {
                        data.status = text.split("Status/Substatus:")[1].split('\n')[0].trim();
                    }
                    if (data.caseOwner === "Not Found" && text.startsWith("Case Owner:") && text.length > 11) {
                        data.caseOwner = text.split("Case Owner:")[1].split('\n')[0].trim();
                    }
                }
            }

        } catch(e) {
            console.error("[TRACKER] Scrape error: ", e);
        }

        data.caseId = cleanCaseId(data.caseId);
        return data;
    }

    // Pass the executed prompt name into the webhook function
    function sendToSheet(caseData, clickType, executedPromptName) {
        if (caseData.caseId === "Not Found") {
            console.log("⏭️ [TRACKER] Ignored empty data trigger.");
            return;
        }

        const now = Date.now();
        if (now - lastSentTime < 6000) return;
        lastSentTime = now;

        let tseName = getLoggedInUser();

        console.log(`📤 [TRACKER] Forwarding data to Google Sheet for prompt: ${executedPromptName}...`, { tse: tseName, method: clickType, ...caseData });
        GM_xmlhttpRequest({
            method: "POST",
            url: WEBHOOK_URL,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({
                timestamp: new Date().toISOString(),
                user: tseName,
                prompt: executedPromptName,
                caseId: caseData.caseId,
                createdOn: caseData.createdOn,
                caseOwner: caseData.caseOwner,
                status: caseData.status,
                executionMethod: clickType
            })
        });
    }

    document.addEventListener('click', function(e) {
        let path = e.composedPath();

        let isUseButton = false;
        let isUseThisPromptButton = false;
        let isTitleClick = false;
        let isTargetPromptRow = false;

        let activePromptId = null; // Store which prompt was actually matched

        // 1. Identify buttons purely by DOM attributes
        let targetButton = e.target.closest ? e.target.closest('button') : null;

        if (targetButton) {
            let promptId = targetButton.getAttribute('data-prompt-id');

            // Check if the clicked button's ID exists in our tracking list
            if (promptId && TRACKED_PROMPTS[promptId]) {
                isTargetPromptRow = true;
                activePromptId = promptId;

                if (targetButton.classList.contains('prompt-use-btn') || targetButton.classList.contains('ath-personal-use-btn')) {
                    isUseButton = true;
                }
                else if (targetButton.classList.contains('ath-detail-use-btn')) {
                    isUseThisPromptButton = true;
                }
            }
        }

        // 2. Identify the surrounding card (Fallback)
        let targetCard = e.target.closest ? e.target.closest('.ath-personal-row, .ath-prompt-card') : null;
        if (targetCard) {
            let cardId = targetCard.getAttribute('data-id');
            if (cardId && TRACKED_PROMPTS[cardId]) {
                isTargetPromptRow = true;
                // Only overwrite if we don't already have the active ID
                if (!activePromptId) activePromptId = cardId;
            }
        }

        let contextHasStoreSignatures = false;
        let contextHasUseBtnText = false;

        // 3. Scan for Title clicks (Shortcuts)
        for (let i = 0; i < Math.min(path.length, 10); i++) {
            let node = path[i];
            if (node && node.nodeType === 1) {
                let text = (node.innerText || node.textContent || "").trim();

                if (i < 4) {
                    // Check against all tracked prompt names
                    for (const [id, name] of Object.entries(TRACKED_PROMPTS)) {
                        if (text.includes(name)) {
                            isTitleClick = true;
                            if (!activePromptId) activePromptId = id;
                        }
                    }
                }
                if (text.includes("Duplicate") || text.includes("FEATURED")) contextHasStoreSignatures = true;
                if (text.includes("Use") || text.includes("play_arrow")) contextHasUseBtnText = true;
            }
        }

        let shouldFire = false;
        let clickedMethod = "";

        if (isUseButton && isTargetPromptRow) {
            shouldFire = true;
            clickedMethod = "Use Button";
            console.log(`🎯 [TRACKER] 'Use' list/grid button clicked for ${TRACKED_PROMPTS[activePromptId]}`);
        }
        else if (isUseThisPromptButton && isTargetPromptRow) {
            shouldFire = true;
            clickedMethod = "Use this Prompt Detail Button";
            console.log(`🎯 [TRACKER] 'Use this Prompt' details button clicked for ${TRACKED_PROMPTS[activePromptId]}`);
        }
        else if (isTitleClick && !contextHasStoreSignatures && !contextHasUseBtnText && activePromptId) {
            shouldFire = true;
            clickedMethod = "Shortcut Pill";
            console.log(`🎯 [TRACKER] Favorite pill clicked! for ${TRACKED_PROMPTS[activePromptId]}`);
        }

        if (shouldFire && activePromptId) {
            setTimeout(() => {
                let data = scrapePage();
                let promptName = TRACKED_PROMPTS[activePromptId];
                sendToSheet(data, clickedMethod, promptName);
            }, 500);
        }
    }, true);

    console.log("🛡️ [TRACKER] Context Engine Active. Observer Removed.");
})();
