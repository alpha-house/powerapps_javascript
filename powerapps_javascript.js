/**
 * Boreal – Referral → Intake automation
 */
var Boreal = (function () {
    "use strict";

    const Approved = 747630000;

    function isAccepted(v) { return v === Approved; }

    /** OnLoad: remember starting status */
    function onReferralFormLoad(executionContext) {
        const formCtx = executionContext.getFormContext();
        window.__boreal_initialStatus =
            formCtx.getAttribute("ahb_referralcomitteestatus").getValue();
    }

    /** OnSave: create ahb_intake when required */
    function onReferralFormSave(executionContext) {
        const formCtx  = executionContext.getFormContext();
        const formType = formCtx.ui.getFormType();          // 1‑Create, 2‑Update
        const newStat  = formCtx.getAttribute("ahb_referralcomitteestatus").getValue();

        const mustCreate =
            (formType === 1 && isAccepted(newStat)) ||
            (formType === 2 &&
             !isAccepted(window.__boreal_initialStatus) && isAccepted(newStat));

        if (!mustCreate) return;

        /* ----- Gather IDs ----- */

        // client lookup
        const clientRef = formCtx.getAttribute("ahb_client").getValue();
        if (!clientRef || clientRef.length === 0) {
            console.error("Boreal: ahb_client empty – cannot create intake.");
            return;
        }
        const clientId = clientRef[0].id.replace(/[{}]/g, "");

        // referral ID (may still be null during create)
        const referralId = formCtx.data.entity.getId().replace(/[{}]/g, "");

        /* ----- Build payload ----- */

        const payload = {
            "ahb_Client@odata.bind": `/contacts(${clientId})`
        };

        // Only bind the referral when it truly exists (update scenario)
        if (formType === 2 && referralId) {
            payload["ahb_Referral@odata.bind"] = `/ahb_referrals(${referralId})`;
        }

        /* ----- Create intake ----- */

        Xrm.WebApi.createRecord("ahb_intake", payload).then(
            r => console.log(`Boreal: intake created → ${r.id}`),
            e => console.error(`Boreal: failed to create intake – ${e.message}`)
        );
    }

    return {
        onReferralFormLoad,
        onReferralFormSave
    };
})();


// code block separator


// module‐level flag so we don’t re-enter our own save
var _isManualSave = false;

function onSaveHandler(executionContext) {
    var formContext = executionContext.getFormContext();
    var eventArgs   = executionContext.getEventArgs();

    // 1) If this is our own manual save retry, let it through
    if (_isManualSave) {
        _isManualSave = false;
        return;
    }

    // 2) Block the default save until we validate
    eventArgs.preventDefault();

    // 3) Gather IDs
    var rawId = formContext.data.entity.getId();
    var currentId = rawId ? rawId.replace(/[{}]/g, "") : null;
    var intake = formContext.getAttribute("ahb_movein")?.getValue();
    if (!intake || !intake.length) {
        // No intake → nothing to check
        _isManualSave = true;
        formContext.data.save();
        return;
    }
    var intakeId = intake[0].id.replace(/[{}]/g, "");

    // 4) Build OData filter excluding current record
    var filter = `_ahb_movein_value eq ${intakeId}`;
    if (currentId) filter += ` and ahb_transitionalhousingassessmentid ne ${currentId}`;
    var query = [
        "?$select=createdon,ahb_dateofmoveout",
        "&$filter=", filter,
        "&$orderby=createdon desc"
    ].join("");

    // 5) Do the async check
    Xrm.WebApi.retrieveMultipleRecords("ahb_transitionalhousingassessment", query)
      .then(function(resp) {
        var list = resp.entities || [];

        // 5a) No other assessments → OK
        if (list.length === 0) {
            _isManualSave = true;
            formContext.data.save();
            return;
        }

        // 5b) Find latest & validate move-out + move-in constraints
        var mostRecent = list.reduce(function(a, b) {
            return new Date(b.createdon) > new Date(a.createdon) ? b : a;
        });

        // grab current record's Move In and current system datetime
        var currentMoveIn = formContext.getAttribute("ahb_dateofmovein").getValue();
        var now = new Date();

        // combined condition:
        // 1) no move-out on the most recent
        // OR 2) currentMoveIn < mostRecent.ahb_dateofmoveout
        // OR 3) currentMoveIn > now
        if (
            !mostRecent.ahb_dateofmoveout ||
			!currentMoveIn ||
            (currentMoveIn && currentMoveIn < new Date(mostRecent.ahb_dateofmoveout)) ||
            (currentMoveIn && currentMoveIn > now)
        ) {
            // Block save & show notification
            formContext.ui.setFormNotification(
              "Please complete the 'Move Out' section of the most-recent Assessment, and ensure your Move In is after that date and not in the future.",
              "ERROR",
              "moveOutErr"
            );
        } else {
            // Passed → allow save
            _isManualSave = true;
            formContext.data.save();
        }
      })
      .catch(function(err) {
        console.error(err.message);
        // On error, let them save
        _isManualSave = true;
        formContext.data.save();
      });
}


// code block separator

function onSaveExitHandler(executionContext) {
    var formContext = executionContext.getFormContext();
    var eventArgs   = executionContext.getEventArgs();

    // 1) If this is our own manual save retry, let it through
    if (_isManualSave) {
        _isManualSave = false;
        return;
    }

    // 2) Block the default save until we validate
    eventArgs.preventDefault();

    // 3) Gather IDs
    var rawId = formContext.data.entity.getId();
    var currentId = rawId ? rawId.replace(/[{}]/g, "") : null;
    var intake = formContext.getAttribute("ahb_movein")?.getValue();
    if (!intake || !intake.length) {
        // No intake → nothing to check
        _isManualSave = true;
        formContext.data.save();
        return;
    }
    var intakeId = intake[0].id.replace(/[{}]/g, "");

    // 4) Build OData filter excluding current record
    var filter = `_ahb_movein_value eq ${intakeId}`;
    if (currentId) filter += ` and ahb_transitionalhousingassessmentid ne ${currentId}`;
    var query = [
        "?$select=createdon,ahb_dateofmoveout",
        "&$filter=", filter,
        "&$orderby=createdon desc"
    ].join("");

    // 5) Do the async check
    Xrm.WebApi.retrieveMultipleRecords("ahb_transitionalhousingassessment", query)
      .then(function(resp) {
        var list = resp.entities || [];

        // 5a) No other assessments → OK
        if (list.length === 0) {
            _isManualSave = true;
            formContext.data.save();
            return;
        }

        // 5b) Find latest & validate move-out + move-in constraints
        var mostRecent = list.reduce(function(a, b) {
            return new Date(b.createdon) > new Date(a.createdon) ? b : a;
        });

        // grab current record's Move In and current system datetime
        var currentMoveIn = formContext.getAttribute("ahb_programexitdate").getValue();
        var now = new Date();

        // combined condition:
        // 1) no move-out on the most recent
        // OR 2) currentMoveIn < mostRecent.ahb_dateofmoveout
        // OR 3) currentMoveIn > now
        if (
            !mostRecent.ahb_dateofmoveout ||
			!currentMoveIn ||
            (currentMoveIn && currentMoveIn < new Date(mostRecent.ahb_dateofmoveout)) ||
            (currentMoveIn && currentMoveIn > now)
        ) {
            // Block save & show notification
            formContext.ui.setFormNotification(
              "Please complete the 'Move Out' section of the most-recent Transitional Housing Assessment, and ensure your Move In is after that date and not in the future.",
              "ERROR",
              "moveOutErr"
            );
        } else {
            // Passed → allow save
            _isManualSave = true;
            formContext.data.save();
        }
      })
      .catch(function(err) {
        console.error(err.message);
        // On error, let them save
        _isManualSave = true;
        formContext.data.save();
      });
}

// code block separator

function controlFieldVisibility(executionContext) {
    var formContext = executionContext.getFormContext();
    var userRoles = Xrm.Utility.getGlobalContext().userSettings.roles.getAll();
    var allowedRoles = ["System Administrator", "System Customizer", "AHC Beta Tester", "Boreal Managers", "Boreal Directors", "Boreal Senior Management"];
    var hasAccess = userRoles.some(function(role) {
        return allowedRoles.includes(role.name);
    });

    formContext.getControl("ahb_referralcomitteestatus").setVisible(hasAccess);
    formContext.getControl("ahb_pendingreason").setVisible(hasAccess);
}



// code block separator



var ReferralForm = ReferralForm || {};

ReferralForm.handleConsistentIncomeChange = function(executionContext) {
    var formContext = executionContext.getFormContext();

    // Get the current value of ahb_hasconsistentincome
    var hasConsistentIncome = formContext
        .getAttribute("ahb_hasconsistentincome")
        .getValue();

    // If the user selects "No" (121570001), set sourcesofincome to ["No Income"]
    if (hasConsistentIncome === 121570001) {
        // Multi-choice fields accept an array of numeric option values
        formContext
            .getAttribute("ahb_sourcesofincome")
            .setValue([747630016]);
    }
    // Otherwise, you could clear the field or leave existing selections
    else {
        // Uncomment to clear when they switch back to "Yes"
        //formContext.getAttribute("ahb_sourcesofincome").setValue([]);
    }
};



// code block separator



function toggleWebResourceVisibility(executionContext) {
    var formContext = executionContext.getFormContext();
    var chronic_or_episodic = formContext.getAttribute("ahb_chronicorepisodichomelessness").getValue(); // Replace with your field's schema name
    var ChronicwebResourceControl = formContext.getControl("WebResource_chronic_homelessness"); // Replace with your web resource's name
	var EpisodicwebResourceControl = formContext.getControl("WebResource_episodic_homelessness"); // Replace with your web resource's name

    if (chronic_or_episodic === 747630000) { // Replace with your condition
        ChronicwebResourceControl.setVisible(true);
		EpisodicwebResourceControl.setVisible(false);
    } else if (chronic_or_episodic === 747630001) {
        ChronicwebResourceControl.setVisible(false);
		EpisodicwebResourceControl.setVisible(true);
    } else {
		ChronicwebResourceControl.setVisible(false);
		EpisodicwebResourceControl.setVisible(false);
	}
}

function disableAddNewClientButton(executionContext) {
    var formContext = executionContext.getFormContext();
    var clientControl = formContext.getControl("ahb_client");

    if (clientControl && clientControl.setShowNewButton) {
        clientControl.setShowNewButton(false); // Hides the + New button
    }
}



// code block separator



function validateConsentDate(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // ::: Get the current system date and time
    var currentdatetime = new Date();

    // ::: Get the value of 'ahb_date'
    var consentdatetime = formContext.getAttribute("ahb_date").getValue();

    // ::: Compare 'currentdatetime' to 'ahb_date'
    if (consentdatetime && consentdatetime > currentdatetime) {
        // ::: Set 'ahb_date' to 'currentdatetime'
        formContext.getAttribute("ahb_date").setValue(currentdatetime);

        // Clear any error notifications so that the form is considered valid
        formContext.getControl("ahb_date").clearNotification("dateNotification");

        // Optionally, alert the user that the value has been auto-corrected
        alert("The consent date cannot be in the future. It has been reset to the current date and time.");
    } else {
        // If the date is valid, ensure any previous notifications are cleared.
        formContext.getControl("ahb_date").clearNotification("dateNotification");
    }
}



// code block separator



function validateROIDate(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // ::: Get the current system date and time
    var currentdatetime = new Date();

    // ::: Get the value of 'ahb_clientsignaturedate'
    var roidatetime = formContext.getAttribute("ahb_clientsignaturedate").getValue();

    // ::: Compare 'currentdatetime' to 'ahb_clientsignaturedate'
    if (roidatetime && roidatetime > currentdatetime) {
        // ::: Set 'ahb_clientsignaturedate' to 'currentdatetime'
        formContext.getAttribute("ahb_clientsignaturedate").setValue(currentdatetime);

        // Clear any error notifications so that the form is considered valid
        formContext.getControl("ahb_clientsignaturedate").clearNotification("dateNotification");

        // Optionally, alert the user that the value has been auto-corrected
        alert("The ROI date cannot be in the future. It has been reset to the current date and time.");
    } else {
        // If the date is valid, ensure any previous notifications are cleared.
        formContext.getControl("ahb_clientsignaturedate").clearNotification("dateNotification");
    }
}


// code block separator


function HelpTicketApprovalVisibility(executionContext) {
    var formContext = executionContext.getFormContext();
    var userRoles = Xrm.Utility.getGlobalContext().userSettings.roles.getAll();
    var allowedRoles = ["System Administrator", "System Customizer", "AHC Beta Tester"];
    var hasAccess = userRoles.some(function(role) {
        return allowedRoles.includes(role.name);
    });

    formContext.getControl("ahb_ticketstatus").setVisible(hasAccess);
  
}


function SetTicketDateToNow(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // --- Work out the current moment in UTC ---
    var now            = new Date();                                   // local browser time
    var utcMillis      = now.getTime() + (now.getTimezoneOffset() * 60000);

    // --- Shift that UTC time to MDT (UTC-6) ---
    var mdtMillis      = utcMillis - (6 * 60 * 60 * 1000);             // subtract 6 h
    var mdtDate        = new Date(mdtMillis);

    // --- Set ahb_ticketdate to MDT ---
    formContext.getAttribute("ahb_ticketdate").setValue(mdtDate);
}


// code block separator


function validateSpdatDate(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // ::: Get the current system date and time
    var currentdatetime = new Date();

    // ::: Get the value of 'ahb_spdatdateofcompletion'
    var spdatdatetime = formContext.getAttribute("ahb_spdatdateofcompletion").getValue();

    // ::: Compare 'currentdatetime' to 'ahb_spdatdateofcompletion'
            if (
            !spdatdatetime ||
            (spdatdatetime && spdatdatetime > currentdatetime)
        ) {
        // ::: Set 'spdatdatetime' to 'currentdatetime'
        formContext.getAttribute("ahb_spdatdateofcompletion").setValue(currentdatetime);

        // Clear any error notifications so that the form is considered valid
        formContext.getControl("ahb_spdatdateofcompletion").clearNotification("dateNotification");

        // Optionally, alert the user that the value has been auto-corrected
        alert("SPDAT Date of Completion cannot be in the future. It has been reset to the current date and time.");
    } else {
        // If the date is valid, ensure any previous notifications are cleared.
        formContext.getControl("ahb_spdatdateofcompletion").clearNotification("dateNotification");
    }
}


// code block separator


/**
 * JavaScript Web Resource for Model-Driven Power Apps (Dynamics 365)
 *
 * This function runs on the ahb_intake form. It retrieves all related
 * ahb_transitionalhousingassessment records, finds the most recent one
 * (by CreatedOn), and, based on its Date of Move In and Transition Type,
 * sets this intake’s ahb_dueforfollowup field to “Yes” (121570000) or “No” (121570001).
 *
 * Usage:
 * 1. Add this JavaScript as a Web Resource.
 * 2. On the ahb_intake form, register checkFollowUpStatus as an OnSave (or OnLoad) handler.
 */

function checkFollowUpStatus(executionContext) {
    var formContext = executionContext.getFormContext();

    // 1. Get the current intake record’s ID (no braces)
    var rawId = formContext.data.entity.getId();
    if (!rawId) {
        // Unsaved record → nothing to check
        return;
    }
    var intakeId = rawId.replace(/[{}]/g, "");

    // 2. Build OData query to retrieve all assessments where _ahb_intake_value eq intakeId
    //    Select CreatedOn, ahb_dateofmovein, ahb_transitiontype; order by CreatedOn desc
    var query = [
        "?$select=createdon,ahb_dateofmovein,ahb_transitiontype",
        "&$filter=_ahb_movein_value eq ", intakeId,
        "&$orderby=createdon desc"
    ].join("");

    Xrm.WebApi.retrieveMultipleRecords("ahb_transitionalhousingassessment", query).then(function (resp) {
        var related_assessments = resp.entities || [];

        // 3. If no related assessments exist, set Follow Up = No and return
        if (related_assessments.length === 0) {
            updateIntakeFollowUp(intakeId, 121570001);
            return;
        }

        // 4. Extract all CreatedOn timestamps (in milliseconds since epoch)
        var all_times_ms = related_assessments.map(function (rec) {
            return new Date(rec.createdon).getTime();
        });

        // 5. Find the maximum timestamp (the most recent CreatedOn)
        var maxMs = Math.max.apply(null, all_times_ms);

        // 6. Filter to the single record with CreatedOn == maxMs
        var last_record = related_assessments.filter(function (rec) {
            return new Date(rec.createdon).getTime() === maxMs;
        })[0];

        if (!last_record) {
            // Fallback: if something went wrong, set Follow Up = No
            updateIntakeFollowUp(intakeId, 121570001);
            return;
        }

        // 7. Extract ahb_dateofmovein and ahb_transitiontype from last_record
        var lastMoveIn = last_record.ahb_dateofmovein
            ? new Date(last_record.ahb_dateofmovein)
            : null;
        var lastTransitionType = last_record.ahb_transitiontype;

        // 8. Compute the cutoff date = now minus 12 months
        var now = new Date();
        var twelveMonthsAgo = new Date(
            now.getFullYear() - 1,
            now.getMonth(),
            now.getDate(),
            now.getHours(),
            now.getMinutes(),
            now.getSeconds()
        );

        // 9. Check:
        //    • lastMoveIn exists AND lastMoveIn ≤ twelveMonthsAgo
        //    • lastTransitionType is 747630001 (Into Independent Housing)
        //      OR 747630003 (Re-entry Into Independent Housing)
        if (
            lastMoveIn &&
            lastMoveIn.getTime() <= twelveMonthsAgo.getTime() &&
            (lastTransitionType === 747630001 || lastTransitionType === 747630003)
        ) {
            // Set ahb_dueforfollowup = Yes (121570000)
            updateIntakeFollowUp(intakeId, 121570000);
        } else {
            // Otherwise, set ahb_dueforfollowup = No (121570001)
            updateIntakeFollowUp(intakeId, 121570001);
        }

    }).catch(function (error) {
        console.error("Error retrieving related assessments: " + error.message);
    });

    /**
     * Helper: Updates the ahb_intake record’s ahb_dueforfollowup field.
     * @param {string} intakeId - GUID of the ahb_intake (without braces)
     * @param {number} optionValue - OptionSet value: 121570000 (Yes) or 121570001 (No)
     */
    function updateIntakeFollowUp(intakeId, optionValue) {
        var intakeUpdate = {};
        intakeUpdate.ahb_dueforfollowup = optionValue;

        Xrm.WebApi.updateRecord("ahb_intake", intakeId, intakeUpdate)
            .then(function () {
                // Follow-up status updated successfully
            })
            .catch(function (err) {
                console.error("Error updating ahb_intake record: " + err.message);
            });
    }
}


// code block separator



/**
 * JavaScript Web Resource for Model-Driven Power Apps (Dynamics 365)
 *
 * This function runs on the ahb_intake form. It retrieves all related
 * ahb_exitassessment records, finds the most recent one (by CreatedOn),
 * and, based on whether its ahb_programexitdate contains data, sets this
 * intake’s ahb_discharged field to “Yes” (121570000) or “No” (121570001).
 *
 * Usage:
 * 1. Add this JavaScript as a Web Resource.
 * 2. On the ahb_intake form, register checkDischargedStatus as an OnSave (or OnLoad) handler.
 */

function checkDischargedStatus(executionContext) {
    var formContext = executionContext.getFormContext();

    // 1. Get the current intake record’s ID (no braces)
    var rawId = formContext.data.entity.getId();
    if (!rawId) {
        // Unsaved record → nothing to check
        return;
    }
    var intakeId = rawId.replace(/[{}]/g, "");

    // 2. Build OData query to retrieve all exit assessments where _ahb_intake_value eq intakeId
    //    Select CreatedOn and ahb_programexitdate; order by CreatedOn desc
    var query = [
        "?$select=createdon,ahb_programexitdate",
        "&$filter=_ahb_movein_value eq ", intakeId,
        "&$orderby=createdon desc"
    ].join("");

    Xrm.WebApi.retrieveMultipleRecords("ahb_exitassessment", query).then(function (resp) {
        var related_exit_assessments = resp.entities || [];

        // 3. If no related exit assessments exist, set Discharged = No and return
        if (related_exit_assessments.length === 0) {
            updateIntakeDischarged(intakeId, 121570001);
            return;
        }

        // 4. Extract all CreatedOn timestamps (in milliseconds since epoch)
        var all_times_ms = related_exit_assessments.map(function (rec) {
            return new Date(rec.createdon).getTime();
        });

        // 5. Find the maximum timestamp (the most recent CreatedOn)
        var maxMs = Math.max.apply(null, all_times_ms);

        // 6. Filter to the single record with CreatedOn == maxMs
        var last_record = related_exit_assessments.filter(function (rec) {
            return new Date(rec.createdon).getTime() === maxMs;
        })[0];

        if (!last_record) {
            // Fallback: if something went wrong, set Discharged = No
            updateIntakeDischarged(intakeId, 121570001);
            return;
        }

        // 7. Check if ahb_programexitdate contains data
        var exitDate = last_record.ahb_programexitdate
            ? new Date(last_record.ahb_programexitdate)
            : null;

        if (exitDate) {
            // Set ahb_discharged = Yes (121570000)
            updateIntakeDischarged(intakeId, 121570000);
        } else {
            // Otherwise, set ahb_discharged = No (121570001)
            updateIntakeDischarged(intakeId, 121570001);
        }

    }).catch(function (error) {
        console.error("Error retrieving related exit assessments: " + error.message);
    });

    /**
     * Helper: Updates the ahb_intake record’s ahb_discharged field.
     * @param {string} intakeId - GUID of the ahb_intake (without braces)
     * @param {number} optionValue - OptionSet value: 121570000 (Yes) or 121570001 (No)
     */
    function updateIntakeDischarged(intakeId, optionValue) {
        var intakeUpdate = {};
        intakeUpdate.ahb_discharged = optionValue;

        Xrm.WebApi.updateRecord("ahb_intake", intakeId, intakeUpdate)
            .then(function () {
                // ahb_discharged updated successfully
            })
            .catch(function (err) {
                console.error("Error updating ahb_intake record: " + err.message);
            });
    }
}


function setShiftType(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // Retrieve the shift date and time value
    var shiftDateTime = formContext.getAttribute("cp_shiftdateandtime").getValue();
    
    if (shiftDateTime) {
        // Extract the hour from the date (0-23)
        var hour = shiftDateTime.getHours();

        // Check if the time is between 7:00 AM and 7:00 PM
        if (hour >= 7 && hour < 19) {
            formContext.getAttribute("cp_shifttype").setValue("Day Shift");
        } else {
            // Covers time between 7:00 PM and 7:00 AM
            formContext.getAttribute("cp_shifttype").setValue("Night Shift");
        }
    } else {
        // Optionally, clear the shift type if no date is provided
        formContext.getAttribute("cp_shifttype").setValue(null);
    }
}



// code block separator


function setCurrentShiftDateTime(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // Get the current date and time
    var currentDateTime = new Date();

    // Set the date and time in the cp_shiftdateandtime field
    formContext.getAttribute("cp_shiftdateandtime").setValue(currentDateTime);
}




/**
 * setPsudoName
 * Description:
 * This function auto-generates a "pseudo name" for a client when selected on a form.
 * It extracts the client's name from the lookup, removes spaces, converts to lowercase,
 * and stores the last three characters in the `cp_pseudoname` field.
 *
 * Triggered on: OnChange of the `cp_client` lookup field.
 *
 * @param {object} executionContext - The execution context from Power Apps form event
 */
function setPsudoName(executionContext) {
    console.log("🔁 setPsudoName triggered");

    var formContext = executionContext.getFormContext();

    // Get Client Field (Lookup)
    var clientField = formContext.getAttribute("cp_client");
    if (!clientField) {
        console.error("❌ Client field (cp_client) not found");
        return;
    }

    var clientValue = clientField.getValue();
    if (!Array.isArray(clientValue) || clientValue.length === 0) {
        console.warn("⚠️ No client selected");
        return;
    }

    var clientId = clientValue[0].id.replace(/[{}]/g, "");
    console.log("🔎 Client ID:", clientId);

    // Get Pseudo Name Field
    var pseudoField = formContext.getAttribute("cp_pseudoname");
    if (!pseudoField) {
        console.error("❌ Pseudo Name field (cp_pseudoname) not found");
        return;
    }

    console.log("✅ Generating Pseudo Name (PHN check removed)");

    // Process Client Name (Remove Spaces & Convert to Lowercase)
    var clientName = clientValue[0].name.replace(/\s+/g, "").toLowerCase();
    console.log("📦 Processed Client Name:", clientName);

    // Extract the last 3 characters
    var lastThreeLetters = clientName.length >= 3 ? clientName.slice(-3) : clientName;
    console.log("🎯 Final Pseudo Name:", lastThreeLetters);

    // Set the value and trigger UI update
    pseudoField.setValue(lastThreeLetters);
    pseudoField.fireOnChange();
}




// code block separator


//Retrive feilds via lookup
function fetchTableField(executionContext, lookupFieldSchema, targetFieldSchema, targetTable, dataFieldSchema) {
    console.log(`[fetchTableField] Function triggered with parameters:
        lookupFieldSchema=${lookupFieldSchema}, 
        targetFieldSchema=${targetFieldSchema}, 
        targetTable=${targetTable}, 
        dataFieldSchema=${dataFieldSchema}`);

    var formContext = executionContext.getFormContext();
    if (!formContext) {
        console.error("ÃÂ¢ÃÂÃÂ No form context found.");
        return;
    }

    var lookupValue = formContext.getAttribute(lookupFieldSchema)?.getValue();
    console.log(`[fetchTableField] Lookup Field Value:`, lookupValue);

    if (!lookupValue || lookupValue.length === 0) {
        console.warn(`[fetchTableField] No value found in lookup field: ${lookupFieldSchema}`);
        return;
    }

    var recordId = lookupValue[0].id.replace(/[{}]/g, ""); // Remove curly braces
    console.log(`[fetchTableField] Retrieved Record ID: ${recordId}`);

    var query = `?$select=${dataFieldSchema}`;
    console.log(`[fetchTableField] Querying Dataverse: ${targetTable} - ${query}`);

    console.log(`[fetchTableField] Executing API call to retrieve record...`);

    Xrm.WebApi.retrieveRecord(targetTable, recordId, query)
        .then(function (result) {
            console.log(`[fetchTableField] ÃÂ¢ÃÂÃÂ API Call Successful. Retrieved Data:`, result);

            if (result.hasOwnProperty(dataFieldSchema)) {
                if (result[dataFieldSchema] !== null && result[dataFieldSchema] !== undefined) {
                    console.log(`[fetchTableField] Retrieved ${dataFieldSchema}: ${result[dataFieldSchema]}`);
                    formContext.getAttribute(targetFieldSchema).setValue(result[dataFieldSchema]);
                    console.log(`[fetchTableField] Set ${targetFieldSchema} in Admissions to: ${result[dataFieldSchema]}`);
                } else {
                    console.warn(`[fetchTableField] ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ Retrieved ${dataFieldSchema} is null or empty. Setting ${targetFieldSchema} to null.`);
                    formContext.getAttribute(targetFieldSchema).setValue(null);
                }
            } else {
                console.warn(`[fetchTableField] ÃÂ¢ÃÂÃÂ ÃÂ¯ÃÂ¸ÃÂ Field ${dataFieldSchema} not found in retrieved record. Setting ${targetFieldSchema} to null.`);
                formContext.getAttribute(targetFieldSchema).setValue(null);
            }
        })
        .catch(function (error) {
            console.error(`[fetchTableField] ÃÂ¢ÃÂÃÂ API Call Failed. Error:`, error);
        });
}


// code block separator


//reload feild in order to triger down stream events
function reloadLookupField(executionContext, lookupFieldSchema) {
    console.log(`[reloadLookupField] Triggered for lookup field: ${lookupFieldSchema}`);

    var formContext = executionContext.getFormContext();
    if (!formContext) {
        console.error("ÃÂ¢ÃÂÃÂ No form context found.");
        return;
    }

    var lookupAttribute = formContext.getAttribute(lookupFieldSchema);
    if (!lookupAttribute) {
        console.error(`ÃÂ¢ÃÂÃÂ Lookup field '${lookupFieldSchema}' not found.`);
        return;
    }

    var lookupValue = lookupAttribute.getValue();
    console.log(`[reloadLookupField] Current Lookup Value:`, lookupValue);

    if (!lookupValue || lookupValue.length === 0) {
        console.warn(`[reloadLookupField] Lookup field '${lookupFieldSchema}' is empty. Nothing to refresh.`);
        return;
    }

    var recordId = lookupValue[0].id;
    var entityType = lookupValue[0].entityType;
    var recordName = lookupValue[0].name; // Store current name

    console.log(`[reloadLookupField] Reloading Lookup: ID=${recordId}, Entity=${entityType}, Name=${recordName}`);

    // ÃÂ¢ÃÂÃÂ Refresh the lookup by clearing and resetting the value
    lookupAttribute.setValue(null);
    setTimeout(() => {
        lookupAttribute.setValue([{ id: recordId, entityType: entityType, name: recordName }]);
        console.log(`[reloadLookupField] Lookup field '${lookupFieldSchema}' reloaded.`);

        // ÃÂ¢ÃÂÃÂ **Manually Trigger the OnChange Event**
        lookupAttribute.fireOnChange();
        console.log(`[reloadLookupField] OnChange event fired for '${lookupFieldSchema}'.`);
    }, 500); // Small delay to ensure refresh
}


// code block separator


//Limit the number of options that can be selected for choice qustion
function enforceMaxSelections(executionContext, fieldName, maxAllowed) {
    var formContext = executionContext.getFormContext();
    var field = formContext.getAttribute(fieldName);
    var selectedValues = field.getValue();

    console.log(`[enforceMaxSelections] Field: ${fieldName}`);
    console.log(`[enforceMaxSelections] Selected values:`, selectedValues);
    console.log(`[enforceMaxSelections] Max allowed: ${maxAllowed}`);

    if (selectedValues && selectedValues.length > maxAllowed) {
        var message = `You can select up to ${maxAllowed} option${maxAllowed > 1 ? "s" : ""} only.`;
        console.warn(`[enforceMaxSelections] Limit exceeded. Showing alert.`);
        alert(message);

        // Optionally clear or trim:
        // field.setValue(null); // Clears all
        field.setValue(selectedValues.slice(0, maxAllowed)); // Keeps only allowed number
        console.log(`[enforceMaxSelections] Trimmed selection to first ${maxAllowed}:`, selectedValues.slice(0, maxAllowed));
    } else {
        console.log(`[enforceMaxSelections] Within allowed limit. No action taken.`);
    }
}


// code block separator


function toggleWebResourceVisibility(executionContext) {
    console.log("[AssessmentVisibility] toggleWebResourceVisibility triggered.");

    var formContext = executionContext.getFormContext();

    // Logging helper
    function log(message, level = "info") {
        if (level === "error") {
            console.error("[AssessmentVisibility]", message);
        } else {
            console.log("[AssessmentVisibility]", message);
        }
    }

    // Get the Assessment Method field
    var assessmentAttribute = formContext.getAttribute("cp_assessmentmethod");
    if (!assessmentAttribute) {
        log("Attribute 'cp_assessmentmethod' not found on the form.", "error");
        return;
    }

    var assessmentMethod = assessmentAttribute.getValue();
    log(`Assessment Method value: ${assessmentMethod}`);

    // Get the web resource controls by their updated names
    var phoneWebResourceControl = formContext.getControl("WebResource_phone_instructions");
    var inPersonWebResourceControl = formContext.getControl("WebResource_in_person_instructions");


    log("phoneWebResourceControl: " + phoneWebResourceControl);
    log("inPersonWebResourceControl: " + inPersonWebResourceControl);

    if (!phoneWebResourceControl || !inPersonWebResourceControl) {
        log("One or both web resource controls not found on the form.", "error");
        return;
    }

    // Toggle visibility based on the selected assessment method
    if (assessmentMethod === 121570001) {
        log("Displaying In-Person consent instructions.");
        inPersonWebResourceControl.setVisible(true);
        phoneWebResourceControl.setVisible(false);
    } else if (assessmentMethod === 121570000) {
        log("Displaying Phone consent instructions.");
        inPersonWebResourceControl.setVisible(false);
        phoneWebResourceControl.setVisible(true);
    } else {
        log("No valid assessment method selected. Hiding all instructions.");
        inPersonWebResourceControl.setVisible(false);
        phoneWebResourceControl.setVisible(false);
    }
}


// code block separator


function updateAppointmentConcatenation(executionContext) {
    var formContext = executionContext.getFormContext();
    var admissionId = formContext.data.entity.getId();
    if (!admissionId) {
        console.error("No Admission record ID found.");
        return;
    }
    admissionId = admissionId.replace("{", "").replace("}", "");

    var query = "?$select=cp_appointmentdate" +
                "&$expand=cp_AppointmentLocation($select=cp_location)" +
                "&$filter=_cp_admission_value eq " + admissionId;
    console.log("Query build was successful");

    Xrm.WebApi.retrieveMultipleRecords("cp_appointment", query).then(
        function success(result) {
            var concatenatedText = "";

            for (var i = 0; i < result.entities.length; i++) {
                var appointment = result.entities[i];
                var location = appointment.cp_AppointmentLocation.cp_location || "";
                var dateTimeStr = "";
                if (appointment.cp_appointmentdate) {
                    var dt = new Date(appointment.cp_appointmentdate);
                    dateTimeStr = dt.toLocaleString();
                }

                var recordText = location + " - " + dateTimeStr;
                if (concatenatedText.length > 0) {
                    concatenatedText += ", \n";
                }
                concatenatedText += recordText;
            }

            var updateData = {
                cp_appointment: concatenatedText
            };

            Xrm.WebApi.updateRecord("cp_cp_admission", admissionId, updateData).then(
                function successUpdate() {
                    console.log("Admission record updated successfully with concatenated appointment info.");
                },
                function(error) {
                    console.error("Error updating Admission record: " + error.message);
                }
            );
        },
        function(error) {
            console.error("Error retrieving Appointment records: " + error.message);
        }
    );
}



// code block separator



function setServiceRequestDate(executionContext) {
    var formContext = executionContext.getFormContext();
    
    console.log("setServiceRequestDate triggered on save.");

    var admissionId = formContext.data.entity.getId();
    if (!admissionId) {
        console.warn("Admission ID not yet available (unsaved record).");
        return;
    }
    admissionId = admissionId.replace("{", "").replace("}", "");
    console.log("Admission ID:", admissionId);

    var assessmentQuery = "?$select=cp_assessmentid,createdon" +
                          "&$filter=_cp_admission_value eq " + admissionId +
                          "&$orderby=createdon asc&$top=1";

    Xrm.WebApi.retrieveMultipleRecords("cp_assessment", assessmentQuery).then(
        function(assessmentResult) {
            console.log("Assessment Results:", assessmentResult);

            if (assessmentResult.entities.length === 0) {
                console.warn("No Assessments found for this Admission.");
                return;
            }

            var assessmentId = assessmentResult.entities[0].cp_assessmentid;

            var checkinQuery = "?$select=cp_checkindate" +
                               "&$filter=_cp_assessment_value eq " + assessmentId +
                               "&$orderby=cp_checkindate asc&$top=1";

            Xrm.WebApi.retrieveMultipleRecords("cp_checkin", checkinQuery).then(
                function(checkinResult) {
                    console.log("Check-in Results:", checkinResult);

                    if (checkinResult.entities.length === 0) {
                        console.warn("No Check-ins found for this Assessment.");
                        return;
                    }

                    var firstCheckinDate = new Date(checkinResult.entities[0].cp_checkindate);
                    console.log("First Check-in Date:", firstCheckinDate);

                    formContext.getAttribute("cp_servicerequestdate").setValue(firstCheckinDate);
                    formContext.data.entity.save(); // ensure date is saved immediately
                    console.log("Service Request Date set and Admission saved.");
                },
                function(error) {
                    console.error("Check-in retrieval error:", error.message);
                }
            );
        },
        function(error) {
            console.error("Assessment retrieval error:", error.message);
        }
    );
}


// code block separator


function copyAdmissionDateTime(executionContext) {
    // Retrieve the form context
    var formContext = executionContext.getFormContext();

    // Get the value from the cp_admissiondatetime field
    var admissionDateTime = formContext.getAttribute("cp_admissiondatetime").getValue();

    // If the field has a value, set it to cp_admissiondate
    if (admissionDateTime !== null) {
        formContext.getAttribute("cp_admissiondate").setValue(admissionDateTime);
    }
}



// code block separator



function setShiftType(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // Retrieve the shift date and time value
    var shiftDateTime = formContext.getAttribute("cp_shiftdateandtime").getValue();
    
    if (shiftDateTime) {
        // Extract the hour from the date (0-23)
        var hour = shiftDateTime.getHours();

        // Check if the time is between 7:00 AM and 7:00 PM
        if (hour >= 7 && hour < 19) {
            formContext.getAttribute("cp_shifttype").setValue("Day Shift");
        } else {
            // Covers time between 7:00 PM and 7:00 AM
            formContext.getAttribute("cp_shifttype").setValue("Night Shift");
        }
    } else {
        // Optionally, clear the shift type if no date is provided
        formContext.getAttribute("cp_shifttype").setValue(null);
    }
}


function setCurrentShiftDateTime(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // Get the current date and time
    var currentDateTime = new Date();

    // Set the date and time in the cp_shiftdateandtime field
    formContext.getAttribute("cp_shiftdateandtime").setValue(currentDateTime);
}



// code block separator


function updateAdmissionNotes() {
  // Get the current admission record ID (assuming this script runs on the admission form)
  var admissionId = Xrm.Page.data.entity.getId();
  // Clean up the GUID format (remove braces)
  admissionId = admissionId.replace("{", "").replace("}", "");

  // Build the OData query to retrieve shift notes related to this admission.
  // We only need the cp_shiftdateandtime field.
  var query = "?$select=cp_shiftdateandtime&$filter=_cp_admission_value eq " + admissionId;

  // Retrieve the cp_shiftnote records
  Xrm.WebApi.retrieveMultipleRecords("cp_shiftnote", query).then(function (result) {
    var shiftDates = [];

    // Loop through each record and push the cp_shiftdateandtime value (converted to a Date object) into an array.
    if (result.entities.length > 0) {
      for (var i = 0; i < result.entities.length; i++) {
        var note = result.entities[i];
        if (note.cp_shiftdateandtime) {
          shiftDates.push(new Date(note.cp_shiftdateandtime));
        }
      }
    }

    // If no shift note dates are found, then nothing to update.
    if (shiftDates.length === 0) {
      return;
    }

    // Find the most recent datetime among the collected shift note dates.
    var mostRecent = shiftDates.reduce(function (prev, curr) {
      return (prev > curr ? prev : curr);
    });
    var most_recent_datetime = mostRecent;

    // Get the current system date and time.
    var current_datetime = new Date();

    // Helper function to compare if two dates have the same date portion (ignoring time)
    function isSameDate(d1, d2) {
      return d1.getFullYear() === d2.getFullYear() &&
             d1.getMonth() === d2.getMonth() &&
             d1.getDate() === d2.getDate();
    }

    // Helper function to determine if noteDate is yesterday compared to currentDate.
    function isYesterday(noteDate, currentDate) {
      var yesterday = new Date(currentDate);
      yesterday.setDate(currentDate.getDate() - 1);
      return isSameDate(noteDate, yesterday);
    }

    // Determine if the current time is within the day shift window: 7:00 a.m. â 7:00 p.m.
    function isDayShift(date) {
      var hours = date.getHours();
      return (hours >= 7 && hours < 19);
    }

    // Determine if the current time is within the night shift window: 7:00 p.m. â 7:00 a.m.
    // Note: This function covers times from 7:00 p.m. until midnight AND midnight until 7:00 a.m.
    function isNightShift(date) {
      var hours = date.getHours();
      return (hours >= 19 || hours < 7);
    }

    // Prepare an object to hold the update for the admission record.
    // The option set for "Yes" is 121570000.
    var updateData = {};

    // Condition 1:
    // If the most recent shift note date is today AND the current time is in the day shift period,
    // then set cp_daynotescompleted to "Yes".
    if (isSameDate(most_recent_datetime, current_datetime) && isDayShift(current_datetime)) {
      updateData.cp_daynotescompleted = 121570000;
    }
    // Condition 2:
    // If the most recent shift note date is today AND the current time is in the night shift period,
    // then set cp_nightnotescompleted to "Yes".
    else if (isSameDate(most_recent_datetime, current_datetime) && isNightShift(current_datetime)) {
      updateData.cp_nightnotescompleted = 121570000;
    }
    // Condition 3:
    // If the most recent shift note date is yesterday (i.e. note date equals (current date - 1))
    // AND the current time is in the night shift period (past midnight, indicating a continuing night shift),
    // then set cp_nightnotescompleted to "Yes".
    else if (isYesterday(most_recent_datetime, current_datetime) && isNightShift(current_datetime)) {
      updateData.cp_nightnotescompleted = 121570000;
    }
    // Otherwise, do nothing (fields remain unchanged)

    // If any update condition has been met, update the current admission record.
    if (Object.keys(updateData).length > 0) {
      Xrm.WebApi.updateRecord("cp_cp_admission", admissionId, updateData).then(function () {
        console.log("Admission record updated successfully.");
      }, function (error) {
        console.error("Error updating admission record: " + error.message);
      });
    }
  }, function (error) {
    console.error("Error retrieving shift notes: " + error.message);
  });
}



// code block separator


function updateAdmissionTask() {
    // Retrieve the current admission record ID from the form context.
    // (Assumes the web resource is used on the cp_cp_admission form.)
    var admissionId = Xrm.Page.data.entity.getId();
    // Remove any curly braces from the GUID.
    admissionId = admissionId.replace("{", "").replace("}", "");

    // Query the cp_dailytasks table for records related to the current admission.
    // Adjust the filter syntax if needed based on your environment.
    var fetchXml = `
      <fetch>
        <entity name="cp_dailytasks">
          <attribute name="cp_currentdateandtime" />
          <attribute name="cp_tasks" />
          <filter>
            <condition attribute="cp_admission" operator="eq" value="${admissionId}" />
          </filter>
        </entity>
      </fetch>`;

    // Use the Web API to retrieve the related cp_dailytasks records.
    Xrm.WebApi.retrieveMultipleRecords("cp_dailytasks", "?fetchXml=" + encodeURIComponent(fetchXml))
        .then(function (result) {
            var datetime_task_pairs = [];
            if (result.entities.length > 0) {
                // Build the datetime:task pairs.
                result.entities.forEach(function (rec) {
                    // Convert the datetime string into a Date object.
                    var recordDate = new Date(rec.cp_currentdateandtime);
                    datetime_task_pairs.push({
                        datetime: recordDate,
                        task: rec.cp_tasks
                    });
                });

                // Extract all datetime values.
                var all_times = datetime_task_pairs.map(function (item) {
                    return item.datetime;
                });

                // Find the most recent datetime.
                var most_recent_datetime = new Date(Math.max.apply(null, all_times));

                // Find the corresponding task for the most recent datetime.
                var current_task = "";
                datetime_task_pairs.forEach(function (pair) {
                    if (pair.datetime.getTime() === most_recent_datetime.getTime()) {
                        current_task = pair.task;
                    }
                });

                // Prepare the data to update the current admission record.
                var updateData = {
                    cp_dailytasks: current_task
                };

                // Update the current admission record (cp_cp_admission).
                Xrm.WebApi.updateRecord("cp_cp_admission", admissionId, updateData)
                    .then(function () {
                        console.log("Admission record updated with current task: " + current_task);
                    }, function (error) {
                        console.error("Error updating admission record: " + error.message);
                    });
            } else {
                console.log("No cp_dailytasks records found for the current admission.");
            }
        }, function (error) {
            console.error("Error retrieving cp_dailytasks records: " + error.message);
        });
}

// Call the function (or bind it to an event as needed)
updateAdmissionTask();




// code block separator



(function () {
    /**
     * This function collects all related cp_checkin records for the current cp_assessment record,
     * builds an array of cp_checkindate values (converted to MDT and separated by ", \n"), and writes that value into
     * the cp_checkins field on the cp_assessment record.
     *
     * @param {object} executionContext - The form execution context.
     */
    function updateAssessmentWithCheckinDates(executionContext) {
        var formContext = executionContext.getFormContext();
        var assessmentId = formContext.data.entity.getId();
        if (!assessmentId) {
            console.error("No cp_assessment ID found on the form.");
            return;
        }
        // Remove curly braces from the ID if present.
        assessmentId = assessmentId.replace("{", "").replace("}", "");

        // Create an array to hold the checkin dates.
        var checkin_dates = [];

        // Build FetchXML to retrieve cp_checkin records where the cp_assessment lookup matches the current record.
        var fetchXml = [
            "<fetch>",
            "  <entity name='cp_checkin'>",
            "    <attribute name='cp_checkindate' />",
            "    <filter>",
            "      <condition attribute='cp_assessment' operator='eq' value='" + assessmentId + "' />",
            "    </filter>",
            "  </entity>",
            "</fetch>"
        ].join("");

        // Retrieve the related cp_checkin records using the Web API and FetchXML.
        Xrm.WebApi.retrieveMultipleRecords("cp_checkin", "?fetchXml=" + encodeURIComponent(fetchXml)).then(
            function success(result) {
                // For each record, convert the cp_checkindate value from UTC to MDT (UTC - 6 HOURS)
                // and append it to the checkin_dates array.
                result.entities.forEach(function (record) {
                    if (record.cp_checkindate) {
                        var utcDate = new Date(record.cp_checkindate);
                        // Subtract 6 hours (in milliseconds)
                        var mdtDate = new Date(utcDate.getTime());
                        checkin_dates.push(mdtDate.toLocaleString());
                    }
                });

                // Join the array values using ", \n" as the separator.
                var joinedDates = checkin_dates.join(", \n");

                // Prepare the update object to set the cp_checkins field.
                var updateData = {
                    cp_checkins: joinedDates
                };

                // Update the current cp_assessment record with the checkin dates.
                Xrm.WebApi.updateRecord("cp_assessment", assessmentId, updateData).then(
                    function success(updateResult) {
                        console.log("cp_assessment record updated successfully with checkin dates.");
                    },
                    function (error) {
                        console.error("Error updating cp_assessment: " + error.message);
                    }
                );
            },
            function (error) {
                console.error("Error retrieving cp_checkin records: " + error.message);
            }
        );
    }

    // Expose the function to the global scope so it can be called from the form event.
    window.updateAssessmentWithCheckinDates = updateAssessmentWithCheckinDates;
})();



// code block separator


function updateAssessmentSubstances(executionContext) {
    var formContext = executionContext.getFormContext();
    var assessmentId = formContext.data.entity.getId();
    if (!assessmentId) {
        console.error("No Assessment record ID found.");
        return;
    }
    // Remove the curly braces from the GUID.
    assessmentId = assessmentId.replace("{", "").replace("}", "");
    
    // Build the OData query:
    // - Select the cp_usetype field from cp_patternofuse.
    // - Expand the cp_Substance lookup to fetch cp_nameofsubstance.
    // - Filter on the cp_assessment lookup field to get records related to the current assessment.
    var query = "?$select=cp_usetype" +
                "&$expand=cp_Substance($select=cp_nameofsubstance)" +
                "&$filter=_cp_assessment_value eq " + assessmentId;

    Xrm.WebApi.retrieveMultipleRecords("cp_patternofuse", query).then(
        function success(result) {
            // Create the four arrays.
            var all_substances = [];
            var primarySubstances = [];
            var secondarySubstances = [];
            var otherSubstances = [];

            // Loop through each cp_patternofuse record.
            for (var i = 0; i < result.entities.length; i++) {
                var record = result.entities[i];
                var useType = record.cp_usetype;
                var substanceName = "";
                // Retrieve the cp_nameofsubstance value from the related cp_substance record.
                if (record.cp_Substance && record.cp_Substance.cp_nameofsubstance) {
                    substanceName = record.cp_Substance.cp_nameofsubstance;
                }

                // Categorize based on the cp_usetype value.
                if (useType === 121570000) {
                    primarySubstances.push(substanceName);
                } else if (useType === 121570001) {
                    secondarySubstances.push(substanceName);
                } else if (useType === 121570002) {
                    otherSubstances.push(substanceName);
                }
            }

            // Construct a string in the required format.
            var primaryStr = primarySubstances.join(", ");
            var secondaryStr = secondarySubstances.join(", ");
            var otherStr = otherSubstances.join(", ");
            var finalStr = "primary: {" + primaryStr + "} / secondary: {" + secondaryStr + "} / other: {" + otherStr + "}";

            // Write the final string into the all_substances array.
            all_substances.push(finalStr);

            // Update the current cp_assessment record with the final string.
            var updateData = {
                cp_substance: finalStr
            };

            Xrm.WebApi.updateRecord("cp_assessment", assessmentId, updateData).then(
                function successUpdate() {
                    console.log("Assessment record updated successfully with substances info.");
                },
                function(error) {
                    console.error("Error updating Assessment record: " + error.message);
                }
            );
        },
        function(error) {
            console.error("Error retrieving cp_patternofuse records: " + error.message);
        }
    );
}


// code block separator


function validateCheckinDate(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // ::: Get the current system date and time
    var currentdatetime = new Date();

    // ::: Get the value of 'cp_checkindate'
    var checkindatetime = formContext.getAttribute("cp_checkindate").getValue();

    // ::: Compare 'currentdatetime' to 'cp_checkindate'
    if (checkindatetime && checkindatetime > currentdatetime) {
        // ::: Set 'cp_checkindate' to 'currentdatetime'
        formContext.getAttribute("cp_checkindate").setValue(currentdatetime);

        // Clear any error notifications so that the form is considered valid
        formContext.getControl("cp_checkindate").clearNotification("dateNotification");

        // Optionally, alert the user that the value has been auto-corrected
        alert("The check-in date cannot be in the future. It has been reset to the current date and time.");
    } else {
        // If the date is valid, ensure any previous notifications are cleared.
        formContext.getControl("cp_checkindate").clearNotification("dateNotification");
    }
}


// code block separator


function updateAssessmentOutcome(executionContext) {
    "use strict";
    
    // Get form context from the execution context
    var formContext = executionContext.getFormContext();

    // Get the current admission status value from the cp_admissionstatus field
    var admissionStatus = formContext.getAttribute("cp_admissionstatus").getValue();
    
    // Only perform an action if the admission status is set to "Admitted" (121570000)
    if (admissionStatus !== 121570000) {
        return;  // Do nothing if the admission status is not "Admitted"
    }
    
    // Get the related cp_assessment record using the lookup field "cp_assessment"
    var assessmentLookup = formContext.getAttribute("cp_assessment").getValue();
    if (!assessmentLookup || assessmentLookup.length === 0) {
        console.error("No related cp_assessment record found.");
        return;
    }
    
    // Retrieve the assessment record's id and strip any surrounding braces
    var assessmentId = assessmentLookup[0].id.replace("{", "").replace("}", "");

    // Retrieve the current value of the cp_outcome field from the cp_assessment record.
    // We query the cp_assessment record for the cp_outcome field.
    Xrm.WebApi.retrieveRecord("cp_assessment", assessmentId, "?$select=cp_outcome")
        .then(function (assessmentRecord) {
            var outcome = assessmentRecord.cp_outcome;
            
            // Check if the cp_outcome is already set to "Admitted" (121570000)
            if (outcome === 121570000) {
                console.log("Assessment outcome is already set to 'Admitted'. No update needed.");
                return; // Nothing to update
            }
            
            // Otherwise, update the cp_outcome of the related cp_assessment record to "Admitted"
            var updateData = {
                cp_outcome: 121570000
            };

            Xrm.WebApi.updateRecord("cp_assessment", assessmentId, updateData)
                .then(function () {
                    console.log("Assessment record updated successfully with Admitted outcome.");
                }, function (error) {
                    console.error("Error updating assessment record: " + error.message);
                });
        }, function (error) {
            console.error("Error retrieving assessment record: " + error.message);
        });
}


// code block separator


function processAssessmentAndCreateAdmission(executionContext) {
    // Helper: Check if the outcome is one of the desired option values.
    function isDesiredOutcome(value) {
        return value === 121570000 || value === 121570001;
    }
    // Helper: Format a date to "YYYY-MM-DD"
    function formatDateForEdm(dateValue) {
        if (!dateValue) return null;
        var d = new Date(dateValue);
        var year = d.getFullYear();
        var month = ('0' + (d.getMonth() + 1)).slice(-2);
        var day = ('0' + d.getDate()).slice(-2);
        return year + '-' + month + '-' + day;
    }
    
    var formContext = executionContext.getFormContext();
    var newOutcome = formContext.getAttribute("cp_outcome").getValue();
    var formType = formContext.ui.getFormType(); // 1 = Create, 2 = Update, etc.
    
    // Process only if a new record qualifies or an update changes outcome to one of the desired values.
    if ((formType === 1 && isDesiredOutcome(newOutcome)) ||
        (formType === 2 && !isDesiredOutcome(window.initialOutcome) && isDesiredOutcome(newOutcome))) {
        
        // Retrieve client data from the form.
        var firstName = formContext.getAttribute("cp_firstname").getValue();
        var lastName = formContext.getAttribute("cp_lastname").getValue();
        var dob = formContext.getAttribute("cp_dateofbirth").getValue();
		var phone = formContext.getAttribute("cp_phone").getValue();
		var ethnicity = formContext.getAttribute("cp_ethnicity").getValue();
        var formattedDOB = formatDateForEdm(dob);
		
        
        var clientRecord = {
            firstname: firstName,
            lastname: lastName,
            cp_dateofbirth: formattedDOB,
			cp_phone: phone,
			cp_ethnicity: ethnicity,
            cp_gender: formContext.getAttribute("cp_gender").getValue(),
            cp_firstcontactdate: formatDateForEdm(formContext.getAttribute("cp_firstcontactdate").getValue()),
            // Mark as created by an assessment ("Yes" option value: 121570000).
            cp_createdbyassessment: 121570000
        };
        
        // Build an OData query to check for an existing client.
        var query = "?$filter=firstname eq '" + firstName +
                    "' and lastname eq '" + lastName +
                    "' and cp_dateofbirth eq " + formattedDOB;
        
        // This function updates the current assessment record to reference the client
        // and then creates a new admission record that links to both the current assessment and the client.
        function updateAssessmentAndCreateAdmission(clientId) {
            var assessmentId = formContext.data.entity.getId();
            var updatePayload = {
                cp_newclient: 121570001, // "No" option value.
                "cp_Client@odata.bind": "/contacts(" + clientId + ")"
            };
            Xrm.WebApi.updateRecord("cp_assessment", assessmentId, updatePayload).then(
                function successUpdate() {
                    console.log("Assessment updated with client reference.");
                    // Clean the assessment ID.
                    var cleanedAssessmentId = assessmentId.replace('{', '').replace('}', '');
                    // Build the admission record payload.
                    // Note: The assessment lookup now uses "cp_Assessment" (with capital "A") and
                    // the client lookup is assigned to the "cp_client" field.
                    var admissionRecord = {
                        "cp_Assessment@odata.bind": "/cp_assessments(" + cleanedAssessmentId + ")",
                        "cp_Client@odata.bind": "/contacts(" + clientId + ")"
                    };
                    Xrm.WebApi.createRecord("cp_cp_admission", admissionRecord).then(
                        function successAdmission(result) {
                            console.log("Admission record created with ID: " + result.id);
                        },
                        function errorAdmission(error) {
                            console.error("Error creating admission record: " + error.message);
                        }
                    );
                },
                function errorUpdate(error) {
                    console.error("Error updating assessment record: " + error.message);
                }
            );
        }
        
        // Check if the client exists. If yes, update assessment and create admission; if not, create the client then proceed.
        Xrm.WebApi.retrieveMultipleRecords("contact", query).then(
            function success(result) {
                if (result.entities && result.entities.length > 0) {
                    console.log("Client already exists. Using existing client record.");
                    var existingClientId = result.entities[0].contactid;
                    existingClientId = existingClientId.replace('{', '').replace('}', '');
                    updateAssessmentAndCreateAdmission(existingClientId);
                } else {
                    Xrm.WebApi.createRecord("contact", clientRecord).then(
                        function successCreate(clientResult) {
                            console.log("Client record created with ID: " + clientResult.id);
                            var newClientId = clientResult.id.replace('{', '').replace('}', '');
                            updateAssessmentAndCreateAdmission(newClientId);
                        },
                        function errorCreate(error) {
                            console.error("Error creating client record: " + error.message);
                        }
                    );
                }
            },
            function errorRetrieve(error) {
                console.error("Error retrieving client record: " + error.message);
            }
        );
    } else {
        console.log("Assessment outcome is not eligible for processing.");
    }
}


// code block separator


function updateAssessmentOutcomeToDeclinedBed(executionContext) {
    // Get the form context from the execution context.
    var formContext = executionContext.getFormContext();

    // Retrieve the value from the cp_declinedbed field.
    var declinedValue = formContext.getAttribute("cp_declinedbed").getValue();

    // Check if the declined bed field is set to 'Yes':121570000.
    if (declinedValue === 121570000) {
        // Set the cp_admissionstatus field of the current admission record to "None":121570003.
        formContext.getAttribute("cp_admissionstatus").setValue(121570003);
        
        // Get the lookup value from the cp_assessment field (note the name change).
        var assessmentLookup = formContext.getAttribute("cp_assessment").getValue();
        if (assessmentLookup != null && assessmentLookup.length > 0) {
            // Extract the assessment record's GUID and remove any surrounding braces.
            var assessmentId = assessmentLookup[0].id.replace("{", "").replace("}", "");

            // Prepare the update data to set the cp_outcome field to "Declined Bed":121570002.
            var updateData = {
                "cp_outcome": 121570002
            };

            // Update the related assessment record using the Xrm.WebApi.
            Xrm.WebApi.updateRecord("cp_assessment", assessmentId, updateData).then(
                function success(result) {
                    console.log("Successfully updated the related assessment outcome.");
                },
                function(error) {
                    console.error("Error updating assessment record: " + error.message);
                }
            );
        }
    }
    // If cp_declinedbed is 'No':121570001, no action is taken.
}








