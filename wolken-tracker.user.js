// ==UserScript==
// @name         APJ Storage Wolken Prompt Tracker
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Differentiates Store Browsing from Execute Actions flawlessly
// @match        *://*.wolkenservicedesk.com/*
// @match        *://broadcomcms-software-agent.wolkenservicedesk.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// @updateURL    https://gist.githubusercontent.com/YOUR_USERNAME/raw/wolken-tracker.user.js
// @downloadURL  https://gist.githubusercontent.com/YOUR_USERNAME/raw/wolken-tracker.user.js
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
        return cleaned || rawId;
    }

    function scrapePage() {
        let data = { caseId: "Not Found", createdOn: "Not Found", caseOwner: "Not Found", status: "Not Found" };

        try {
            const elements = document.querySelectorAll('div, span, label, td, th, p, b, strong, input');
            for (let i = 0; i < elements.length; i++) {
                let text = (elements[i].innerText || elements[i].textContent || elements[i].value || "").trim();
                if (!text) continue;

                let cleanText = text.replace(/^ts_/, '');

                if (cleanText.includes("Case Number:") && cleanText.split("Case Number:")[1]?.trim()) {
                    data.caseId = cleanText.split("Case Number:")[1].trim();
                }
                if (cleanText.includes("Date/Time Created:") && cleanText.split("Date/Time Created:")[1]?.trim()) {
                    data.createdOn = cleanText.split("Date/Time Created:")[1].trim();
                }
                if (cleanText.includes("Case Owner:") && cleanText.split("Case Owner:")[1]?.trim()) {
                    data.caseOwner = cleanText.split("Case Owner:")[1].trim();
                }
                if (cleanText.includes("Status/Substatus:") && cleanText.split("Status/Substatus:")[1]?.trim()) {
                    data.status = cleanText.split("Status/Substatus:")[1].trim();
                }

                if ((cleanText === "Case Number:" || cleanText === "Case Number") && elements[i+1]) {
                    let val = (elements[i+1].innerText || elements[i+1].value || "").trim();
                    if (val && data.caseId === "Not Found") data.caseId = val;
                }
                if ((cleanText === "Date/Time Created:" || cleanText === "Date/Time Created") && elements[i+1]) {
                    let val = (elements[i+1].innerText || elements[i+1].value || "").trim();
                    if (val && data.createdOn === "Not Found") data.createdOn = val;
                }
                if ((cleanText === "Case Owner:" || cleanText === "Case Owner") && elements[i+1]) {
                    let val = (elements[i+1].innerText || elements[i+1].value || "").trim();
                    if (val && data.caseOwner === "Not Found") data.caseOwner = val;
                }
                if ((cleanText === "Status/Substatus:" || cleanText === "Status/Substatus") && elements[i+1]) {
                    let val = (elements[i+1].innerText || elements[i+1].value || "").trim();
                    if (val && data.status === "Not Found") data.status = val;
                }
            }

            if (data.caseId === "Not Found") {
                let urlMatch = window.location.href.match(/(\d{7,10})/);
                if (urlMatch) data.caseId = urlMatch[1];
            }
        } catch(e) {}

        data.caseId = cleanCaseId(data.caseId);
        return data;
    }

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

        let contextHasStoreSignatures = false;
        let contextHasUseBtnText = false;
        let contextHasTargetName = false;

        for (let i = 0; i < Math.min(path.length, 4); i++) {
            let node = path[i];
            if (node && node.nodeType === 1) {
                let text = (node.innerText || node.textContent || node.title || "").trim();

                if (text === "Use") isUseButton = true;
                if (text === "Use this Prompt" || text.includes("Use this Prompt")) isUseThisPromptButton = true;
                if (text.includes(TARGET_PROMPT_NAME)) isTitleClick = true;
            }
        }

        for (let i = 0; i < Math.min(path.length, 10); i++) {
            let node = path[i];
            if (node && node.nodeType === 1) {
                let text = (node.innerText || node.textContent || "").trim();

                if (text.includes("Duplicate") || text.includes("FEATURED")) contextHasStoreSignatures = true;
                if (text.includes("Use")) contextHasUseBtnText = true;
                if (text.includes(TARGET_PROMPT_NAME)) contextHasTargetName = true;
            }
        }

        let shouldFire = false;

        if (isUseButton && contextHasTargetName) {
            shouldFire = true;
            console.log("🎯 [TRACKER] 'Use' list button clicked!");
        }
        else if (isUseThisPromptButton && (contextHasTargetName || document.body.innerText.includes(TARGET_PROMPT_NAME))) {
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
