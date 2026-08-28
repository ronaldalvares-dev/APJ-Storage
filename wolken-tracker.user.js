// ==UserScript==
// @name         APJ Storage Wolken Prompt Tracker
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Differentiates Store Browsing from Execute Actions flawlessly using DOM attributes
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
    const TARGET_PROMPT_NAME = "KCS Case Owner Responsibilities";

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
        // If regex strips everything (e.g. it was just an icon), return the raw string so we don't return an empty string
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
                    // CRITICAL FIX: Clone the node and remove icons/buttons before reading the text
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

    // Webhook Dispatcher
    function sendToSheet(caseData) {
        if (caseData.caseId === "Not Found") {
            console.log("⏭️ [TRACKER] Ignored empty data trigger.");
            return;
        }

        const now = Date.now();
        if (now - lastSentTime < 6000) return;
        lastSentTime = now;

        let tseName = getLoggedInUser();

        console.log("📤 [TRACKER] Forwarding scraped data to Google Sheet...", { tse: tseName, ...caseData });
        GM_xmlhttpRequest({
            method: "POST",
            url: WEBHOOK_URL,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({
                timestamp: new Date().toISOString(),
                user: tseName,
                prompt: "shared_kcs_case_owner_responsibilities",
                caseId: caseData.caseId,
                createdOn: caseData.createdOn,
                caseOwner: caseData.caseOwner,
                status: caseData.status
            })
        });
    }

    document.addEventListener('click', function(e) {
        let path = e.composedPath();

        let isUseButton = false;
        let isUseThisPromptButton = false;
        let isTitleClick = false;
        let isTargetPromptRow = false;

        let targetButton = e.target.closest ? e.target.closest('button') : null;

        if (targetButton) {
            let promptId = targetButton.getAttribute('data-prompt-id');

            if (promptId === 'shared_kcs_case_owner_responsibilities') {
                isTargetPromptRow = true;

                if (targetButton.classList.contains('prompt-use-btn') || targetButton.classList.contains('ath-personal-use-btn')) {
                    isUseButton = true;
                }
                else if (targetButton.classList.contains('ath-detail-use-btn')) {
                    isUseThisPromptButton = true;
                }
            }
        }

        let targetCard = e.target.closest ? e.target.closest('[data-id="shared_kcs_case_owner_responsibilities"]') : null;
        if (targetCard) {
            isTargetPromptRow = true;
        }

        let contextHasStoreSignatures = false;
        let contextHasUseBtnText = false;

        for (let i = 0; i < Math.min(path.length, 10); i++) {
            let node = path[i];
            if (node && node.nodeType === 1) {
                let text = (node.innerText || node.textContent || "").trim();

                if (i < 4 && text.includes(TARGET_PROMPT_NAME)) isTitleClick = true;
                if (text.includes("Duplicate") || text.includes("FEATURED")) contextHasStoreSignatures = true;
                if (text.includes("Use") || text.includes("play_arrow")) contextHasUseBtnText = true;
            }
        }

        let shouldFire = false;

        if (isUseButton && isTargetPromptRow) {
            shouldFire = true;
            console.log("🎯 [TRACKER] 'Use' list/grid button clicked!");
        }
        else if (isUseThisPromptButton && isTargetPromptRow) {
            shouldFire = true;
            console.log("🎯 [TRACKER] 'Use this Prompt' details button clicked!");
        }
        else if (isTitleClick && !contextHasStoreSignatures && !contextHasUseBtnText) {
            shouldFire = true;
            console.log("🎯 [TRACKER] Favorite pill clicked! (Verified outside store)");
        }

        if (shouldFire) {
            setTimeout(() => {
                let data = scrapePage();
                sendToSheet(data);
            }, 500);
        }
    }, true);

    console.log("🛡️ [TRACKER] Context Engine Active. Observer Removed.");
})();
