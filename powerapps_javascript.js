/**
 * Boreal – Referral → Intake automation
 * Now handles both Approved (747630000) and
 * Approved for Scattered Site (747630003), setting
 * ahb_intakelocation on the new intake.
 */
var Boreal = (function () {
    "use strict";

    // Status values
    const Approved            = 747630000;
    const ApprovedScattered   = 747630003;

    // Helper: either approved status?
    function isAccepted(v) {
        return v === Approved || v === ApprovedScattered;
    }

    /** OnLoad: remember starting status */
    function onReferralFormLoad(executionContext) {
        const formCtx = executionContext.getFormContext();
        window.__boreal_initialStatus =
            formCtx.getAttribute("ahb_referralcomitteestatus").getValue();
    }

    /** OnSave: create ahb_intake when status flips into one of the approved states */
    function onReferralFormSave(executionContext) {
        const formCtx  = executionContext.getFormContext();
        const formType = formCtx.ui.getFormType();   // 1 = Create, 2 = Update
        const newStat  = formCtx.getAttribute("ahb_referralcomitteestatus").getValue();

        const mustCreate =
            (formType === 1 && isAccepted(newStat)) ||
            (formType === 2 &&
             !isAccepted(window.__boreal_initialStatus) &&
              isAccepted(newStat));

        if (!mustCreate) return;

        /* ----- Gather IDs ----- */
        const clientRef = formCtx.getAttribute("ahb_client").getValue();
        if (!clientRef || clientRef.length === 0) {
            console.error("Boreal: ahb_client empty – cannot create intake.");
            return;
        }
        const clientId   = clientRef[0].id.replace(/[{}]/g, "");
        const referralId = formCtx.data.entity.getId().replace(/[{}]/g, "");

        /* ----- Build payload ----- */
        const payload = {
            // link to contact
            "ahb_Client@odata.bind": `/contacts(${clientId})`
        };

        // on update, also link back to this referral
        if (formType === 2 && referralId) {
            payload["ahb_Referral@odata.bind"] = `/ahb_referrals(${referralId})`;
        }

        // set intake location based on which approval status fired it
        if (newStat === Approved) {
            payload["ahb_intakelocation"] = 747630000;
        } else if (newStat === ApprovedScattered) {
            payload["ahb_intakelocation"] = 747630001;
        }

        /* ----- Create intake ----- */
        Xrm.WebApi.createRecord("ahb_intake", payload).then(
            r => console.log(`Boreal: intake created → ${r.id}`),
            e => console.error(`Boreal: failed to create intake – ${e.message}`)
        );
    }

    return {
        onReferralFormLoad: onReferralFormLoad,
        onReferralFormSave: onReferralFormSave
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
    var shiftDateTime = formContext.getAttribute("createdon").getValue();
    
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




// code block separator




function preventAutoSave(econtext) {
  var eventArgs = econtext.getEventArgs();
  // 70 = AutoSave, 2 = Save & Close
  if (eventArgs.getSaveMode() === 70 || eventArgs.getSaveMode() === 2) {
    eventArgs.preventDefault();
  }
}


function setCurrentDateTime(executionContext, attributeSchemaName) {
  var formContext = executionContext.getFormContext();

  // 1 = Create (unsaved new record), 2 = Update (already saved)
  var formType = formContext.ui.getFormType();
  if (formType !== 1) {
    // Not a brand-new record: do nothing
    return;
  }

  var name = attributeSchemaName;
  var attr = formContext.getAttribute(name);
  if (!attr) return;            // field missing on form
  if (attr.getValue()) return;  // someone already set it (don’t overwrite)

  // Set current date/time (user local)
  attr.setValue(new Date());
}



// ----------------------------------------------------------------------------------------------------Boreal Ends Here----------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------Detox Starts Here----------------------------------------------------------------------------------------------------
// ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


function setPseudoNameIfPHN(executionContext) {
    console.log("ÃÂ°ÃÂÃÂÃÂ setPseudoName triggered!");

    var formContext = executionContext.getFormContext();$select

    // Get Client Field (Lookup)
    var clientField = formContext.getAttribute("cp_client");
    if (!clientField) {
        console.error("ÃÂ¢ÃÂÃÂ Client field (cp_client) not found!");
        return;
    }

    var clientValue = clientField.getValue();
    if (!Array.isArray(clientValue) || clientValue.length === 0) {
        console.warn("ÃÂ¢ÃÂÃÂ  No client selected.");
        return;
    }

    var clientId = clientValue[0].id.replace(/[{}]/g, ""); // Extract the Client ID 
    console.log("ÃÂ°ÃÂÃÂÃÂ Client ID:", clientId);

    // Get Pseudo Name Field
    var pseudoField = formContext.getAttribute("cp_pseudoname");
    if (!pseudoField) {
        console.error("ÃÂ¢ÃÂÃÂ Pseudo Name field (cp_pseudoname) not found!");
        return;
    }

    // Fetch Client Record from Dataverse to check PHN (cp_ahcnumber)
    Xrm.WebApi.retrieveRecord("contact", clientId, "?$select=cp_ahcnumber").then(
        function (result) {
            console.log("ÃÂ°ÃÂÃÂÃÂ¢ Client PHN (cp_ahcnumber):", result.cp_ahcnumber);

            // If PHN exists, clear Pseudo Name field
            if (result.cp_ahcnumber) {
                console.warn("ÃÂ¢ÃÂÃÂ PHN exists, clearing Pseudo Name.");
                pseudoField.setValue("");
                pseudoField.fireOnChange();
                return;
            }

            console.log("ÃÂ¢ÃÂÃÂ PHN is empty, generating Pseudo Name.");

            // Process Client Name (Remove Spaces & Convert to Lowercase)
            var clientName = clientValue[0].name.replace(/\s+/g, "").toLowerCase();
            console.log("ÃÂ°ÃÂÃÂÃÂ¢ Processed Client Name:", clientName);

            // Extract the last 3 characters
            var lastThreeLetters = clientName.length >= 3 ? clientName.slice(-3) : clientName;

            console.log("ÃÂ¢ÃÂÃÂ Final Pseudo Name (No Spaces, Lowercase):", lastThreeLetters);

            // Set the value and trigger UI update
            pseudoField.setValue(lastThreeLetters);
            pseudoField.fireOnChange();
        },
        function (error) {
            console.error("ÃÂ¢ÃÂÃÂ Error retrieving Client PHN:", error.message);
        }
    );
}



// ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


///MDRATE data, field settings. Set fields based on detox addmission requiermeents

//Set the postal code to requiered, and 
function setPostalCodeToRequired(executionContext) {
    console.log("ÃÂ°ÃÂÃÂÃÂ setPostalCodeToRequired triggered!");

    var formContext = executionContext.getFormContext();
    if (!formContext) {
        console.error("ÃÂ¢ÃÂÃÂ Form context not found!");
        return;
    }

    var programField = formContext.getAttribute("cp_program");

    if (!programField) {
        console.error("ÃÂ¢ÃÂÃÂ Program field (cp_program) not found!");
        return;
    }

    var programValue = programField.getValue(); // Get selected value (array)
    console.log("ÃÂ°ÃÂÃÂÃÂ¢ Raw Program Value:", programValue);

    // ÃÂ¢ÃÂÃÂ Extract program name safely from lookup array
    var programName = programValue && programValue.length > 0 ? programValue[0].name : null;
    console.log("ÃÂ°ÃÂÃÂÃÂ¢ Extracted Program Name:", programName);

    if (programName && programName.toLowerCase() === "detox") {
        console.log("ÃÂ¢ÃÂÃÂ Program is Detox. Setting Postal Code as required...");

        var postalCodeField = formContext.getAttribute("cp_postalcode");
        var postalCodeControl = formContext.getControl("cp_postalcode");

        if (postalCodeField) {
            postalCodeField.setRequiredLevel("required");
            console.log("ÃÂ¢ÃÂÃÂ Postal Code field set to Required.");
        } else {
            console.warn("ÃÂ¢ÃÂÃÂ  Postal Code field (cp_postalcode) not found.");
        }

        if (postalCodeControl) {
            postalCodeControl.setLabel("Postal Code" +
                " ÃÂ¢ÃÂÃÂ¢ Enter ÃÂ¢ÃÂÃÂA9A 9A9ÃÂ¢ÃÂÃÂ if missing or unknown - " +
                " ÃÂ¢ÃÂÃÂ¢ Enter ÃÂ¢ÃÂÃÂA1A 1A1ÃÂ¢ÃÂÃÂ if the client has no fixed address");
            console.log("ÃÂ¢ÃÂÃÂ Postal Code field label updated.");
        } else {
            console.warn("ÃÂ¢ÃÂÃÂ  Postal Code control not found.");
        }
    } else {
        console.log("ÃÂ¢ÃÂÃÂ Program is NOT Detox. Resetting Postal Code field properties...");

        var postalCodeField = formContext.getAttribute("cp_postalcode");
        var postalCodeControl = formContext.getControl("cp_postalcode");

        if (postalCodeField) {
            postalCodeField.setRequiredLevel("none"); // Remove required status
            console.log("ÃÂ¢ÃÂÃÂ Postal Code field set to Optional.");
        } else {
            console.warn("ÃÂ¢ÃÂÃÂ  Postal Code field (cp_postalcode) not found.");
        }

        if (postalCodeControl) {
            postalCodeControl.setLabel("Postal Code"); // Reset label
            console.log("ÃÂ¢ÃÂÃÂ Postal Code field label reset.");
        } else {
            console.warn("ÃÂ¢ÃÂÃÂ  Postal Code control not found.");
        }
    }
}



// ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------



//Copy MDRATE fields that exist other tables =======

function setPsudoName(executionContext) {
    console.log("ÃÂ°ÃÂÃÂÃÂ setPseudoName triggered!");

    var formContext = executionContext.getFormContext();

    // Get Client Field (Lookup)
    var clientField = formContext.getAttribute("cp_client");
    if (!clientField) {
        console.error("ÃÂ¢ÃÂÃÂ Client field (cp_client) not found!");
        return;
    }

    var clientValue = clientField.getValue();
    if (!Array.isArray(clientValue) || clientValue.length === 0) {
        console.warn("ÃÂ¢ÃÂÃÂ  No client selected.");
        return;
    }

    var clientId = clientValue[0].id.replace(/[{}]/g, ""); // Extract the Client ID
    console.log("ÃÂ°ÃÂÃÂÃÂ Client ID:", clientId);

    // Get Pseudo Name Field
    var pseudoField = formContext.getAttribute("cp_pseudoname");
    if (!pseudoField) {
        console.error("ÃÂ¢ÃÂÃÂ Pseudo Name field (cp_pseudoname) not found!");
        return;
    }

    console.log("ÃÂ¢ÃÂÃÂ Generating Pseudo Name for all clients (PHN check removed).");

    // Process Client Name (Remove Spaces & Convert to Lowercase)
    var clientName = clientValue[0].name.replace(/\s+/g, "").toLowerCase();
    console.log("ÃÂ°ÃÂÃÂÃÂ¢ Processed Client Name:", clientName);

    // Extract the last 3 characters
    var lastThreeLetters = clientName.length >= 3 ? clientName.slice(-3) : clientName;

    console.log("ÃÂ¢ÃÂÃÂ Final Pseudo Name (No Spaces, Lowercase):", lastThreeLetters);

    // Set the value and trigger UI update
    pseudoField.setValue(lastThreeLetters);
    pseudoField.fireOnChange();
}



// ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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


// ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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


// ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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


// ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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


// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------



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


// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------



function setShiftType(executionContext) {
    // Get the form context
    var formContext = executionContext.getFormContext();

    // Retrieve the shift date and time value
    var shiftDateTime = formContext.getAttribute("createdon").getValue();
    
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



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------



function setCurrentShiftDateTime(executionContext) {
  var formContext = executionContext.getFormContext();

  // 1 = Create (unsaved new record), 2 = Update (already saved)
  var formType = formContext.ui.getFormType();
  if (formType !== 1) {
    // Not a brand‑new record: do nothing
    return;
  }

  var attr = formContext.getAttribute("cp_shiftdateandtime");
  if (!attr) return;                 // field missing on form
  if (attr.getValue()) return;       // someone already set it (don’t overwrite)

  // Set current date/time (user local)
  attr.setValue(new Date());
}



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------



function setCheckinDateToCurrentTime(executionContext) {
  var formContext = executionContext.getFormContext();

  // 1 = Create (unsaved new record), 2 = Update (already saved)
  var formType = formContext.ui.getFormType();
  if (formType !== 1) {
    // Not a brand‑new record: do nothing
    return;
  }

  var attr = formContext.getAttribute("cp_checkindate");
  if (!attr) return;                 // field missing on form
  if (attr.getValue()) return;       // someone already set it (don’t overwrite)

  // Set current date/time (user local)
  attr.setValue(new Date());
}



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------



function setAssessmentDateTimeToCurrentTime(executionContext) {
  var formContext = executionContext.getFormContext();

  // 1 = Create (unsaved new record), 2 = Update (already saved)
  var formType = formContext.ui.getFormType();
  if (formType !== 1) {
    // Not a brand‑new record: do nothing
    return;
  }

  var attr = formContext.getAttribute("cp_assessmentdateandtime");
  if (!attr) return;                 // field missing on form
  if (attr.getValue()) return;       // someone already set it (don’t overwrite)

  // Set current date/time (user local)
  attr.setValue(new Date());
}



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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




// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------



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



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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
            var finalStr = primaryStr + ", " + secondaryStr + ", " + otherStr;

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


// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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


// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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


// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------



// OnLoad function to set cp_preventduplicate if outcome is Admitted or Bed on Hold
function setPreventDuplicateOnLoad(executionContext) {
    var formContext = executionContext.getFormContext();
    var outcomeAttr = formContext.getAttribute("cp_outcome");
    if (outcomeAttr) {
        var outcomeText = outcomeAttr.getText();  // get label of the outcome choice
        // If outcome is "Admitted" or "Bed on Hold", mark prevent-duplicate flag as Yes (121570000)
        if (outcomeText === "Admitted" || outcomeText === "Bed on Hold") {
            formContext.getAttribute("cp_preventduplicate").setValue(121570000);
        }
    }
}


// =========================
// OnSave: ONLY for existing forms (formType 2)
// If cp_preventduplicate != Yes(121570000), set it to Yes and call processAssessmentAndCreateAdmission
// =========================
function createClientandAdmission4OldAssessment(executionContext) {
  var formContext = executionContext.getFormContext();

  // Run ONLY on existing records
  var formType = formContext.ui.getFormType(); // 1=Create, 2=Update
  if (formType === 2) {
	
  var preventDupAttr = formContext.getAttribute("cp_preventduplicate");
  if (!preventDupAttr) return;

   var formContext = executionContext.getFormContext();
    var outcomeAttr = formContext.getAttribute("cp_outcome");
        var outcomeText = outcomeAttr.getText();  // get label of the outcome choice
        // If outcome is "Admitted" or "Bed on Hold", mark prevent-duplicate flag as Yes (121570000)

  var current = preventDupAttr.getValue();
if ((outcomeText === "Admitted" || outcomeText === "Bed on Hold") && (current !== 121570000)) {
    preventDupAttr.setValue(121570000); // Yes
    // call your existing function (unchanged) and pass executionContext
    processAssessmentAndCreateAdmission(executionContext);
  } else {
    return; // already marked, do nothing
  }
  }

}

function createClientandAdmission4NewAssessment(executionContext){

 var formContext = executionContext.getFormContext();
 
  var formType = formContext.ui.getFormType(); // 1=Create, 2=Update
  if (formType === 1) {
	  processAssessmentAndCreateAdmission(executionContext);
  }
  
  
  
// OnLoad handler: Store the initial outcome value on the Assessment Form for later comparison. This function is currently used in the another library named cp_create_client_or_admit_from_assessment
// and it is called within the function processAssessmentAndCreateAdmission.
function setInitialOutcomeOnAssessment(executionContext) {
    var formContext = executionContext.getFormContext();
    var outcome = formContext.getAttribute("cp_outcome").getValue();
    window.initialOutcome = outcome;
}



function processAssessmentAndCreateAdmission(executionContext) {
  var formContext = executionContext.getFormContext();

  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  // Helpers
  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  function isDesiredOutcome(value) {
    return value === 121570000 || value === 121570001; // Admitted or Bed on Hold
  }
  function formatDateForEdm(dateValue) {
    if (!dateValue) return null;
    var d = new Date(dateValue),
        yyyy = d.getFullYear(),
        mm   = ('0' + (d.getMonth() + 1)).slice(-2),
        dd   = ('0' + d.getDate()).slice(-2);
    return yyyy + '-' + mm + '-' + dd;
  }

  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  // 1) Only run if outcome has just become Admitted/Bed-on-Hold
  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  var newOutcome = formContext.getAttribute("cp_outcome").getValue();
  var formType   = formContext.ui.getFormType(); // 1=Create, 2=Update
  if (!(
      (formType === 1 && isDesiredOutcome(newOutcome)) ||
      (formType === 2 &&
         !isDesiredOutcome(window.initialOutcome) &&
          isDesiredOutcome(newOutcome)
      )
    )) {
    console.log("Skipping: outcome not in target set.");
    return;
  }

  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  // 2) If cp_newclient = No (121570001), use existing client
  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  var newClientFlag = formContext.getAttribute("cp_newclient").getValue();
  if (newClientFlag === 121570001) {
    var clientLookup = formContext.getAttribute("cp_client").getValue();
    if (clientLookup && clientLookup.length) {
      var existingClientId = clientLookup[0].id.replace(/[{}]/g, '');
      console.log("Existing client; skipping contact create.");
      updateAssessmentAndCreateAdmission(existingClientId);
    } else {
      console.error("Cannot proceed: cp_client lookup is empty.");
    }
    return;  // done
  }

  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  // 3) Otherwise, build clientRecord & query for existing contact
  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  var firstName = formContext.getAttribute("cp_firstname").getValue();
  var lastName  = formContext.getAttribute("cp_lastname").getValue();
  var dobRaw    = formContext.getAttribute("cp_dateofbirth").getValue();
  var formattedDOB = formatDateForEdm(dobRaw);

  // bail if any lookup key is missing
  if (!firstName || !lastName || !formattedDOB) {
    console.error("Missing details; cannot find or create client.", {
      firstName, lastName, formattedDOB
    });
    return;
  }

  var clientRecord = {
    firstname: firstName,
    lastname: lastName,
    cp_dateofbirth: formattedDOB,
    cp_gender: formContext.getAttribute("cp_gender").getValue(),
    cp_ethnicity: formContext.getAttribute("cp_ethnicity").getValue(),
    cp_firstcontactdate: formatDateForEdm(formContext.getAttribute("cp_firstcontactdate").getValue()),
    cp_createdbyassessment: 121570000
  };

  // OData filter: unquoted date
  var esc = function(str) { return str.replace(/'/g, "''"); };
  var query = "?$filter=firstname eq '" + esc(firstName) +
              "' and lastname eq '" + esc(lastName) +
              "' and cp_dateofbirth eq " + formattedDOB;

  console.log("Querying existing contacts:", query);
  Xrm.WebApi.retrieveMultipleRecords("contact", query).then(
    function success(result) {
      if (result.entities.length > 0) {
        var clientId = result.entities[0].contactid.replace(/[{}]/g, '');
        console.log("Found existing client:", clientId);
        updateAssessmentAndCreateAdmission(clientId);
      } else {
        console.log("No client found; creating new one.");
        Xrm.WebApi.createRecord("contact", clientRecord).then(
          function(res) {
            var newId = res.id.replace(/[{}]/g, '');
            console.log("Created client:", newId);
            updateAssessmentAndCreateAdmission(newId);
          },
          function(err) {
            console.error("Error creating client:", err.message);
          }
        );
      }
    },
    function error(err) {
      console.error("Lookup failed:", err.message);
    }
  );

  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  // Nested function: updates assessment and conditionally creates admission
  // –––––––––––––––––––––––––––––––––––––––––––––––––––––––––
  function updateAssessmentAndCreateAdmission(clientId) {
    var assessmentId = formContext.data.entity.getId().replace(/[{}]/g, '');
    var updatePayload = {
      cp_newclient: 121570001,
      "cp_Client@odata.bind": "/contacts(" + clientId + ")"
    };

    Xrm.WebApi.updateRecord("cp_assessment", assessmentId, updatePayload)
      .then(function() {
        console.log("Assessment updated; checking for existing admissions...");
        var admissionQuery = "?$filter=_cp_assessment_value eq " + assessmentId;
        return Xrm.WebApi.retrieveMultipleRecords("cp_cp_admission", admissionQuery);
      })
      .then(function(result) {
        if (result.entities.length > 0) {
          console.log("Admission already exists; skipping creation.");
          return;
        }
        console.log("No admission found; creating admission...");
        var admissionPayload = {
          "cp_Assessment@odata.bind": "/cp_assessments(" + assessmentId + ")",
          "cp_Client@odata.bind":     "/contacts(" + clientId   + ")"
        };
        return Xrm.WebApi.createRecord("cp_cp_admission", admissionPayload);
      })
      .then(function(createResult) {
        if (createResult && createResult.id) {
          console.log("Admission created: " + createResult.id);
        }
      })
      .catch(function(err) {
        console.error("Error in update/create:", err.message);
      });
	}
  }
}



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


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



// // ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------



function ShiftSupervisorSignedoffVisibility(executionContext) {
    var formContext = executionContext.getFormContext();
    var userRoles = Xrm.Utility.getGlobalContext().userSettings.roles.getAll();
    var allowedRoles = ["System Administrator", "System Customizer", "AHC Beta Tester", "Detox Supervisor", "Detox Managers", "Detox Directors", "Detox Senior Management"];
    var hasAccess = userRoles.some(function(role) {
        return allowedRoles.includes(role.name);
    });

    formContext.getControl("cp_shiftsupervisorsignedoff").setVisible(hasAccess);
    formContext.getControl("cp_shiftsupervisorsignature").setVisible(hasAccess);
}


//On change 
function checkRecentAssessmentForClient(executionContext) {
    console.log("🔍 checkRecentAssessmentForClient triggered!");

    var formContext = executionContext.getFormContext();
    if (!formContext) {
        console.error("❌ Form context not found!");
        return;
    }

    // Get Client Field (Lookup)
    var clientField = formContext.getAttribute("cp_client");
    if (!clientField) {
        console.warn("⚠️ Client field (cp_client) not found!");
        return;
    }

    var clientValue = clientField.getValue();
    if (!Array.isArray(clientValue) || clientValue.length === 0) {
        console.warn("⚠️ No client selected.");
        return;
    }

    var clientId = clientValue[0].id.replace(/[{}]/g, ""); // Extract the Client ID
    var clientName = clientValue[0].name;
    console.log("🔍 Client ID:", clientId);
    console.log("🔍 Client Name:", clientName);

    // Calculate the datetime from 1 hour ago
    var currentDateTime = new Date();
    var oneHourAgo = new Date(currentDateTime.getTime() - (60 * 60 * 1000)); // 1 hour = 60 minutes * 60 seconds * 1000 milliseconds
    
    // Format the datetime for OData query (ISO 8601 format)
    var oneHourAgoISO = oneHourAgo.toISOString();
    console.log("🕐 Checking for assessments created after:", oneHourAgoISO);

    // Get the current assessment ID to exclude it from the search (if we're on an existing assessment)
    var currentAssessmentId = null;
    try {
        var entityId = formContext.data.entity.getId();
        if (entityId) {
            currentAssessmentId = entityId.replace(/[{}]/g, "");
            console.log("📝 Current Assessment ID (will be excluded):", currentAssessmentId);
        }
    } catch (error) {
        console.log("📝 No current assessment ID found (likely a new record)");
    }

    // Build the OData query to find assessments for this client created in the last hour
    var filter = "_cp_client_value eq " + clientId + " and createdon gt " + oneHourAgoISO;
    
    // If we have a current assessment ID, exclude it from the results
    if (currentAssessmentId) {
        filter += " and cp_assessmentid ne " + currentAssessmentId;
    }

    var query = "?$filter=" + filter + "&$select=cp_assessmentid,createdon&$orderby=createdon desc";

    console.log("🔍 Query:", query);

    // Execute the query to check for recent assessments
    Xrm.WebApi.retrieveMultipleRecords("cp_assessment", query).then(
        function (result) {
            console.log("✅ Query successful. Found " + result.entities.length + " recent assessment(s).");
            
            if (result.entities.length > 0) {
                 // Found recent assessment(s) - show warning
                var recentAssessment = result.entities[0]; // Get the most recent one
                var createdDate = new Date(recentAssessment.createdon);
                var timeDifference = Math.round((currentDateTime - createdDate) / (1000 * 60)); // Difference in minutes
                
                console.log("⚠️ Recent assessment found!");
                console.log("📅 Created:", createdDate.toLocaleString());
                console.log("⏱️ Time difference:", timeDifference + " minutes ago");

                // Create warning message
                var warningMessage = "⚠️ WARNING: Duplicate Assessment Alert\n\n" +
                    "A recent assessment for client '" + clientName + "' was created " + timeDifference + " minutes ago.\n\n" +
                    "Created: " + createdDate.toLocaleString() + "\n\n" +
                    "Please verify if this is a duplicate entry before proceeding.\n\n" +
                    "Click OK to continue or Cancel to review the existing assessment.";

                // Show confirmation dialog
                var confirmResult = confirm(warningMessage);
                
                if (!confirmResult) {
                    console.log("🚫 User chose to cancel. Stopping form processing.");
                    // Optionally prevent form save or redirect user
                    // You can add additional logic here like:
                    // - Prevent form save
                    // - Redirect to the existing assessment
                    // - Clear the form
                    return false;
                } else {
                    console.log("✅ User confirmed to proceed despite duplicate warning.");
                }
            } else {
                console.log("✅ No recent assessments found for this client in the last hour.");
            }
        },
        function (error) {
            console.error("❌ Error checking for recent assessments:", error.message);
            // Don't block the user if there's an error in the check
        }
    );
}

// OnSave event function that prevents save when duplicate is detected
function checkDuplicateAssessmentOnSave(executionContext) {
    console.log("💾 checkDuplicateAssessmentOnSave triggered!");

    var eventArgs = executionContext.getEventArgs();
    var formContext = executionContext.getFormContext();

    if (!formContext) {
        console.error("❌ Form context not found!");
        return; // Allow save to proceed if we can't check
    }

    // Get Client Field (Lookup)
    var clientField = formContext.getAttribute("cp_client");
    if (!clientField) {
        console.warn("⚠️ Client field (cp_client) not found!");
        return; // Allow save to proceed
    }

    var clientValue = clientField.getValue();
    if (!Array.isArray(clientValue) || clientValue.length === 0) {
        console.warn("⚠️ No client selected.");
        return; // Allow save to proceed
    }

    var clientId = clientValue[0].id.replace(/[{}]/g, "");
    var clientName = clientValue[0].name;
    console.log("💾 Checking duplicates for Client:", clientName, "ID:", clientId);

    // Calculate one hour ago
    var currentDateTime = new Date();
    var oneHourAgo = new Date(currentDateTime.getTime() - (60 * 60 * 1000));
    var oneHourAgoISO = oneHourAgo.toISOString();

    // Get current assessment ID to exclude from search (for updates)
    var currentAssessmentId = null;
    try {
        var entityId = formContext.data.entity.getId();
        if (entityId) {
            currentAssessmentId = entityId.replace(/[{}]/g, "");
            console.log("💾 Current Assessment ID (excluding from search):", currentAssessmentId);
        }
    } catch (error) {
        console.log("💾 New assessment record - no existing ID to exclude");
    }

    // Build query to find recent assessments
    var filter = "_cp_client_value eq " + clientId + " and createdon gt " + oneHourAgoISO;
    if (currentAssessmentId) {
        filter += " and cp_assessmentid ne " + currentAssessmentId;
    }

    var query = "?$filter=" + filter + "&$select=cp_assessmentid,createdon&$orderby=createdon desc&$top=1";
    console.log("💾 Duplicate check query:", query);

    // Prevent the save initially
    eventArgs.preventDefault();
    console.log("💾 Save prevented - checking for duplicates...");

    // Execute the duplicate check
    Xrm.WebApi.retrieveMultipleRecords("cp_assessment", query).then(
        function (result) {
            console.log("💾 Duplicate check complete. Found " + result.entities.length + " recent assessment(s).");
            
            if (result.entities.length > 0) {
                // Duplicate found - show warning and ask user
                var recentAssessment = result.entities[0];
                var createdDate = new Date(recentAssessment.createdon);
                var timeDifference = Math.round((currentDateTime - createdDate) / (1000 * 60));
                
                console.log("⚠️ DUPLICATE DETECTED!");
                console.log("📅 Existing assessment created:", createdDate.toLocaleString());
                console.log("⏱️ Time difference:", timeDifference + " minutes ago");
                console.log("🆔 Existing assessment ID:", recentAssessment.cp_assessmentid);

                var warningMessage = "🚨 DUPLICATE ASSESSMENT DETECTED!\n\n" +
                    "⚠️ STOP: An assessment for client '" + clientName + "' was already created " + timeDifference + " minutes ago.\n\n" +
                    "📅 Existing Assessment Created: " + createdDate.toLocaleString() + "\n" +
                    "🆔 Assessment ID: " + recentAssessment.cp_assessmentid + "\n\n" +
                    "❓ Do you want to proceed with creating this duplicate assessment?\n\n" +
                    "• Click 'OK' to save anyway (duplicate will be created)\n" +
                    "• Click 'Cancel' to stop and review the existing assessment";

                var userConfirmed = confirm(warningMessage);
                
                if (userConfirmed) {
                    console.log("✅ User confirmed to proceed with duplicate save.");
                    
                    // Show a warning notification on the form
                    formContext.ui.setFormNotification(
                        "⚠️ WARNING: This is a duplicate assessment created " + timeDifference + " minutes after an existing one.",
                        "WARNING",
                        "duplicateAssessmentWarning"
                    );
                    
                    // Proceed with save
                    formContext.data.entity.save().then(
                        function() {
                            console.log("✅ Duplicate assessment saved successfully.");
                        },
                        function(error) {
                            console.error("❌ Error saving duplicate assessment:", error.message);
                        }
                    );
                } else {
                    console.log("🚫 User cancelled save due to duplicate warning.");
                    
                    // Show information about the existing assessment
                    formContext.ui.setFormNotification(
                        "❌ Save cancelled - Recent assessment exists for this client (Created: " + createdDate.toLocaleString() + ")",
                        "ERROR",
                        "saveCancelledDuplicate"
                    );
                    
                    // Optionally, you could navigate to the existing assessment
                    // var entityFormOptions = {};
                    // entityFormOptions["entityName"] = "cp_assessment";
                    // entityFormOptions["entityId"] = recentAssessment.cp_assessmentid;
                    // Xrm.Navigation.openForm(entityFormOptions);
                }
            } else {
                console.log("✅ No duplicates found - proceeding with save.");
                
                // Clear any previous duplicate warnings
                formContext.ui.clearFormNotification("duplicateAssessmentWarning");
                formContext.ui.clearFormNotification("saveCancelledDuplicate");
                
                // Proceed with normal save
                formContext.data.entity.save().then(
                    function() {
                        console.log("✅ Assessment saved successfully (no duplicates detected).");
                    },
                    function(error) {
                        console.error("❌ Error saving assessment:", error.message);
                    }
                );
            }
        },
        function (error) {
            console.error("❌ Error checking for duplicates during save:", error.message);
            
            // If there's an error checking for duplicates, allow the save to proceed
            console.log("⚠️ Proceeding with save due to duplicate check error.");
            formContext.data.entity.save();
        }
    );
}


// Synchronous duplicate check function WITH popup that doesn't cause loops
function checkDuplicateAssessmentSync(executionContext) {
    console.log("🔍 Checking for duplicate assessments (synchronous)...");
    
    var formContext = executionContext.getFormContext();
    
    // Get Client Field (Lookup)
    var clientField = formContext.getAttribute("cp_client");
    if (!clientField) {
        console.warn("⚠️ Client field not found - skipping duplicate check");
        return false; // Don't block save
    }

    var clientValue = clientField.getValue();
    if (!Array.isArray(clientValue) || clientValue.length === 0) {
        console.warn("⚠️ No client selected - skipping duplicate check");
        return false; // Don't block save
    }

    var clientId = clientValue[0].id.replace(/[{}]/g, "");
    var clientName = clientValue[0].name;
    console.log("🔍 Checking duplicates for Client:", clientName);

    // Get current assessment ID to exclude from search
    var currentAssessmentId = null;
    try {
        var entityId = formContext.data.entity.getId();
        if (entityId) {
            currentAssessmentId = entityId.replace(/[{}]/g, "");
        }
    } catch (error) {
        // New record - no current ID
    }

    // Calculate one hour ago
    var currentDateTime = new Date();
    var oneHourAgo = new Date(currentDateTime.getTime() - (60 * 60 * 1000));
    var oneHourAgoISO = oneHourAgo.toISOString();

    // Build query
    var filter = "_cp_client_value eq " + clientId + " and createdon gt " + oneHourAgoISO;
    if (currentAssessmentId) {
        filter += " and cp_assessmentid ne " + currentAssessmentId;
    }

    var query = "?$filter=" + filter + "&$select=cp_assessmentid,createdon&$orderby=createdon desc&$top=1";

    // We can't do truly synchronous API calls in the browser, so we'll use a flag system
    // Check if we've already confirmed this save
    if (formContext._duplicateConfirmed) {
        console.log("✅ Duplicate already confirmed - proceeding with save");
        delete formContext._duplicateConfirmed;
        return false; // Don't block save
    }

    // Store the duplicate check for async execution but don't block this save
    setTimeout(function() {
        Xrm.WebApi.retrieveMultipleRecords("cp_assessment", query).then(
            function (result) {
                if (result.entities.length > 0) {
                    var recentAssessment = result.entities[0];
                    var createdDate = new Date(recentAssessment.createdon);
                    var timeDifference = Math.round((currentDateTime - createdDate) / (1000 * 60));
                    
                    console.log("⚠️ DUPLICATE DETECTED!");
                    
                    // Show warning notification on form
                    formContext.ui.setFormNotification(
                        "⚠️ WARNING: Another assessment for " + clientName + " was created " + timeDifference + " minutes ago (ID: " + recentAssessment.cp_assessmentid + ")",
                        "WARNING",
                        "duplicateAssessmentWarning"
                    );
                } else {
                    console.log("✅ No duplicates found.");
                    formContext.ui.clearFormNotification("duplicateAssessmentWarning");
                }
            },
            function (error) {
                console.error("❌ Error checking duplicates:", error.message);
            }
        );
    }, 100);

    // Don't block the save - just show warnings after
    return false;
}






// Simple synchronous orchestrator function for OnSave event
function assessmentSaveOrchestrator(executionContext) {
    console.log("🎯 === ASSESSMENT SAVE ORCHESTRATOR STARTED (SYNC) ===");
    
    var eventArgs = executionContext.getEventArgs();
    var formContext = executionContext.getFormContext();

    if (!formContext) {
        console.error("❌ Form context not found!");
        return;
    }

    // Check if this is a bypass save (to prevent infinite loop)
    if (formContext._bypassOrchestrator) {
        console.log("🔄 Bypass flag detected - skipping orchestrator");
        delete formContext._bypassOrchestrator;
        return;
    }

    // Step 1: Check for duplicates FIRST (most important)
    var shouldBlockSave = false;
    try {
        console.log("🔍 Step 1: Checking for duplicate assessments...");
        shouldBlockSave = checkDuplicateAssessmentSync(executionContext);
        if (shouldBlockSave) {
            console.log("🚫 Save blocked due to duplicate check");
            eventArgs.preventDefault();
            return;
        }
        console.log("✅ Step 1 Complete: Duplicate check passed");
    } catch (error) {
        console.error("❌ Error in Step 1:", error);
        // Continue with save despite error
    }
    
    // Step 2: Update Assessment Substances
    try {
        console.log("💊 Step 2: Updating assessment substances...");
        updateAssessmentSubstances(executionContext);
        console.log("✅ Step 2 Complete: Substances update initiated");
    } catch (error) {
        console.error("❌ Error in Step 2:", error);
        // Continue with save despite error
    }
    
    // Step 3: Update Assessment with Check-in Dates
    try {
        console.log("📋 Step 3: Updating assessment with check-in dates...");
        updateAssessmentWithCheckinDates(executionContext);
        console.log("✅ Step 3 Complete: Check-in dates update initiated");
    } catch (error) {
        console.error("❌ Error in Step 3:", error);
        // Continue with save despite error
    }
    
    // Step 4: Process Assessment and Create Admission (LAST)
    try {
        console.log("📝 Step 4: Processing assessment and creating admission...");
        processAssessmentAndCreateAdmission(executionContext);
        console.log("✅ Step 4 Complete: Assessment processing initiated");
    } catch (error) {
        console.error("❌ Error in Step 4:", error);
        // Continue with save despite error
    }
    
    console.log("🎉 === ALL CHECKS COMPLETE - SAVE PROCEEDING ===");
    // Save proceeds automatically since we didn't call preventDefault()
}


function onIncidentFormSave(executionContext) {
    var formContext = executionContext.getFormContext();
    var eventArgs = executionContext.getEventArgs();
    // Check the Additional Clients field
    var addlValue = formContext.getAttribute("cp_arethereadditionalclientsinvolved").getValue();
    if (addlValue === 121570000) {  // 121570000 = 'Yes'
        // Prevent the default save behavior
        eventArgs.preventDefault();
        // Save the current record first
        formContext.data.save().then(function() {
            var incidentId = formContext.data.entity.getId().replace(/[{}]/g, "");
            // Retrieve the autonumber (reporting reference) of this incident
            Xrm.WebApi.retrieveRecord("cp_incidentreport", incidentId, "?$select=cp_reportingreference").then(function(result) {
                var originalRef = result["cp_reportingreference"];
                // Show alert to user
                var alertStrings = { text: "A New Incident Report will now be created for the next client involved in this incident.", title: "Additional Client Involved" };
                var alertOptions = { height: 120, width: 400 };
                Xrm.Navigation.openAlertDialog(alertStrings, alertOptions).then(function() {
                    // Prepare new form parameters with copied fields
                    var p = {};
                    p["cp_incidenttype"] = formContext.getAttribute("cp_incidenttype").getValue();
                    p["cp_pleaseselecttheserviceforthisreport"] = formContext.getAttribute("cp_pleaseselecttheserviceforthisreport").getValue();
                    p["cp_followuptypeneeded"] = formContext.getAttribute("cp_followuptypeneeded").getValue();
                    p["cp_dateofincident"] = formContext.getAttribute("cp_dateofincident").getValue();
                    p["cp_timeofincident"] = formContext.getAttribute("cp_timeofincident").getValue();
                    p["cp_buildingnameoraddress"] = formContext.getAttribute("cp_buildingnameoraddress").getValue();
                    p["cp_area"] = formContext.getAttribute("cp_area").getValue();
                    p["cp_peopleinvolved"] = formContext.getAttribute("cp_peopleinvolved").getValue();
                    p["cp_arethereadditionalclientsinvolved"] = formContext.getAttribute("cp_arethereadditionalclientsinvolved").getValue();
                    // Lookup fields:
                    var recBy = formContext.getAttribute("cp_incidentrecordedby").getValue();
                    if (recBy && recBy[0]) {
                        p["cp_incidentrecordedby"] = recBy[0].id.replace(/[{}]/g, "");
                        p["cp_incidentrecordedbyname"] = recBy[0].name;
                        p["cp_incidentrecordedbytype"] = recBy[0].entityType;
                    }
                    var sup = formContext.getAttribute("cp_shiftsupervisormanagerpresent").getValue();
                    if (sup && sup[0]) {
                        p["cp_shiftsupervisormanagerpresent"] = sup[0].id.replace(/[{}]/g, "");
                        p["cp_shiftsupervisormanagerpresentname"] = sup[0].name;
                        p["cp_shiftsupervisormanagerpresenttype"] = sup[0].entityType;
                    }
                    // Reporting Reference
                    p["cp_reportingreference"] = originalRef;
                    // Open the new Incident form with these parameters
                    var entityOptions = { entityName: "cp_incidentreport", useQuickCreateForm: false };
                    Xrm.Navigation.openForm(entityOptions, p).catch(function(error) {
                        console.error("Error opening new incident form:", error.message);
                    });
                });
            });
        }, function(error) {
            console.error("Save failed:", error.message);
        });
    }
}


// ----------------------------------------------------------------------------------------------------Code Block separator----------------------------------------------------------------------------------------------------


// File: cp_/Admission.DetoxTransition.js
var medical_to_social_admission = (function () {
  "use strict";

  var DETOX_TYPE = Object.freeze({ MEDICAL: 121570000, SOCIAL: 121570001 });
  var TRANSITION_TO_SOCIAL = Object.freeze({ YES: 121570000, NO: 121570001 });
  var MEDICAL_DISCHARGE_REASON = Object.freeze({ COMPLETED_MEDICAL_DETOX: 121570000 });

  var state = { prevDetoxType: null };

  function onLoad(executionContext) {
    var fc = executionContext.getFormContext();

    // Cache initial Detox Type
    state.prevDetoxType = getAttrVal(fc, "cp_detoxtype");

    // Wire change handlers
    var detoxAttr = fc.getAttribute("cp_detoxtype");
    if (detoxAttr) detoxAttr.addOnChange(onDetoxTypeChange);

    var transitionAttr = fc.getAttribute("cp_isclienttransitioningtosocialadmission");
    if (transitionAttr) transitionAttr.addOnChange(onTransitionChoiceChange);

    // --- YOUR RULE (run FIRST) ---
    // If cp_isclienttransitioningtosocialadmission != Yes:
    //   - clear & hide cp_medicaldischargedate
    //   - clear & hide cp_reasonformedicaldischarge
    //   - set cp_detoxtype = null
    var transitionVal = getAttrVal(fc, "cp_isclienttransitioningtosocialadmission");

    // Existing onLoad show rule (only if Social + Yes)
    var currentDetox = getAttrVal(fc, "cp_detoxtype");
    if (currentDetox === DETOX_TYPE.SOCIAL && transitionVal === TRANSITION_TO_SOCIAL.YES) {
      hideAllControls(fc, "cp_medicaldischargedate", false);
      hideAllControls(fc, "cp_reasonformedicaldischarge", false);
      hideAllControls(fc, "cp_isclienttransitioningtosocialadmission", false);
    }
  }

  function onDetoxTypeChange(executionContext) {
    var fc = executionContext.getFormContext();
    var current = getAttrVal(fc, "cp_detoxtype");
    var prev = state.prevDetoxType;

    if ((prev === null || typeof prev === "undefined") && current === DETOX_TYPE.MEDICAL) {
      // Null -> Medical: no action
    }

    if (prev === DETOX_TYPE.MEDICAL && current === DETOX_TYPE.SOCIAL) {
      hideAllControls(fc, "cp_isclienttransitioningtosocialadmission", false);
      setRequired(fc, "cp_isclienttransitioningtosocialadmission", "required");
    }

    state.prevDetoxType = current;
  }

  function onTransitionChoiceChange(executionContext) {
    var fc = executionContext.getFormContext();
    var choiceVal = getAttrVal(fc, "cp_isclienttransitioningtosocialadmission");

    if (choiceVal === TRANSITION_TO_SOCIAL.YES) {
      hideAllControls(fc, "cp_medicaldischargedate", false);
      hideAllControls(fc, "cp_reasonformedicaldischarge", false);

      var existingDate = getAttrVal(fc, "cp_medicaldischargedate");
      if (!existingDate) setAttrVal(fc, "cp_medicaldischargedate", new Date()); // user local

      setAttrVal(fc, "cp_reasonformedicaldischarge", MEDICAL_DISCHARGE_REASON.COMPLETED_MEDICAL_DETOX);
    }
    // No extra behavior requested for "not Yes" on change; your rule is OnLoad.
  }

  // ---------- Utilities ----------
  function getAttr(fc, name) {
    return fc.getAttribute(name);
  }
  function getAttrVal(fc, name) {
    var a = getAttr(fc, name);
    return a ? a.getValue() : null;
  }
  function setAttrVal(fc, name, val) {
    var a = getAttr(fc, name);
    if (a) a.setValue(val);
  }
  function clearValue(fc, name) {
    var a = getAttr(fc, name);
    if (a) a.setValue(null);
  }
  function hideAllControls(fc, name, hide) {
    // Some attributes appear on multiple form controls; hide/show them all
    var ctrls = fc.ui.controls.get(function (c) { return c.getName && c.getName() === name; });
    if (ctrls && ctrls.length) {
      for (var i = 0; i < ctrls.length; i++) {
        try { ctrls[i].setVisible(!hide ? true : false); } catch (e) { /* ignore */ }
      }
    } else {
      // Fallback single-control lookup
      var c = fc.getControl(name);
      if (c) { try { c.setVisible(!hide ? true : false); } catch (e) {} }
    }
  }
  function setRequired(fc, name, level /* none|required|recommended */) {
    var a = getAttr(fc, name);
    if (a) a.setRequiredLevel(level);
  }

  return { onLoad, onDetoxTypeChange, onTransitionChoiceChange };
})();



  function onTransitionToSocialChange(executionContext) {
    var fc = executionContext.getFormContext();
	
	var DETOX_TYPE = Object.freeze({ MEDICAL: 121570000, SOCIAL: 121570001 });
	var TRANSITION_TO_SOCIAL = Object.freeze({ YES: 121570000, NO: 121570001 });
	var MEDICAL_DISCHARGE_REASON = Object.freeze({ COMPLETED_MEDICAL_DETOX: 121570000 });
	
  // ---------- Utilities ----------
  function getAttr(fc, name) {
    return fc.getAttribute(name);
  }
  function getAttrVal(fc, name) {
    var a = getAttr(fc, name);
    return a ? a.getValue() : null;
  }
  function setAttrVal(fc, name, val) {
    var a = getAttr(fc, name);
    if (a) a.setValue(val);
  }
  function clearValue(fc, name) {
    var a = getAttr(fc, name);
    if (a) a.setValue(null);
  }
  
  function hideAllControls(fc, name, hide) {
    // Some attributes appear on multiple form controls; hide/show them all
    var ctrls = fc.ui.controls.get(function (c) { return c.getName && c.getName() === name; });
    if (ctrls && ctrls.length) {
      for (var i = 0; i < ctrls.length; i++) {
        try { ctrls[i].setVisible(!hide ? true : false); } catch (e) { /* ignore */ }
      }
    } else {
      // Fallback single-control lookup
      var c = fc.getControl(name);
      if (c) { try { c.setVisible(!hide ? true : false); } catch (e) {} }
    }
  }
	
    // --- YOUR RULE (run FIRST) ---
    // If cp_isclienttransitioningtosocialadmission != Yes:
    //   - clear & hide cp_medicaldischargedate
    //   - clear & hide cp_reasonformedicaldischarge
    //   - set cp_detoxtype = null
    var transitionVal = getAttrVal(fc, "cp_isclienttransitioningtosocialadmission");
    if (transitionVal !== TRANSITION_TO_SOCIAL.YES) {
      clearValue(fc, "cp_medicaldischargedate");
      hideAllControls(fc, "cp_medicaldischargedate", true);

      clearValue(fc, "cp_reasonformedicaldischarge");
      hideAllControls(fc, "cp_reasonformedicaldischarge", true);

      // Clear Detox Type as requested
      clearValue(fc, "cp_detoxtype");
    }
		}
		
		
		
//----------------------------------------------------------------------------Code Block separator-----------------------------------------------------------------------



/**
 * Checks if specified fields have data on the current form and displays warnings for missing data
 * @param {object}  executionContext  - Form execution context
 * @param {string}  dialogTitle       - Dialog title (supports \n via escaping)
 * @param {object|string} fieldMapping- Object (or JSON string) mapping field schema names -> display names
 * @param {string}  entityDisplayName - Display name of the entity
 * @param {string}  contextMessage    - Optional additional context (supports \n via escaping)
 * @param {boolean} blockSave         - Prevent save if fields are missing (default: false)
 * @returns {Promise<boolean>}        - true if any fields are missing data; false otherwise
 */
async function checkRequiredFieldsHaveData(
  executionContext,
  dialogTitle,
  fieldMapping,
  entityDisplayName,
  contextMessage,
  blockSave = false
) {
  const formContext = executionContext.getFormContext();
  if (!formContext) {
    console.error("Form context not found!");
    return false;
  }

  // --- helpers ---
  const notifId = "missingDataError_current";

  function normalizeMsg(s) {
    if (typeof s !== "string") return "";
    // Convert literal \n typed in handler params into real newlines
    return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  function isMissing(v) {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;       // lookups/multiselects on form
    if (typeof v === "string") return v.trim() === ""; // strings
    // numbers (0), booleans (false), Date objects are considered present if defined
    return false;
  }

  // Parse mapping if passed as JSON string in handler box
  if (typeof fieldMapping === "string") {
    try { fieldMapping = JSON.parse(fieldMapping); }
    catch (e) {
      console.error("fieldMapping must be valid JSON", e);
      return false;
    }
  }
  if (!fieldMapping || typeof fieldMapping !== "object") {
    console.error("Invalid fieldMapping parameter. Must be an object or JSON string.");
    return false;
  }

  dialogTitle    = normalizeMsg(dialogTitle)    || `Missing ${entityDisplayName} Data`;
  contextMessage = normalizeMsg(contextMessage);

  const fieldsToCheck = Object.keys(fieldMapping);
  if (fieldsToCheck.length === 0) {
    console.warn("No fields provided in fieldMapping.");
    return false;
  }

  // --- Save-blocking guard (prevents infinite loop on re-save) ---
  if (blockSave) {
    if (formContext._bypassValidation) {
      delete formContext._bypassValidation; // allow this save to proceed
      return false;
    }
    const args = executionContext.getEventArgs && executionContext.getEventArgs();
    if (args && typeof args.preventDefault === "function") {
      args.preventDefault(); // stop current save while we validate
    }
  }

  // Check fields on the current form
  const missingDataFields = [];
  const missingFieldsOnForm = [];

  for (const fieldName of fieldsToCheck) {
    const display = fieldMapping[fieldName] || fieldName;
    const attribute = formContext.getAttribute(fieldName);

    if (!attribute) {
      console.warn("Field not found on form:", fieldName);
      missingFieldsOnForm.push(display);
      continue;
    }

    const value = attribute.getValue();
    if (isMissing(value)) {
      console.warn("Field missing data:", fieldName);
      missingDataFields.push(display);
    } else {
      // console.log("Field has data:", fieldName, value);
    }
  }

  // Clear any prior notifications before setting new ones
  formContext.ui.clearFormNotification(notifId);

  // Configuration error: fields not present on form
  if (missingFieldsOnForm.length > 0) {
    const msg =
      `The following fields do not exist on the ${entityDisplayName} form:\n\n` +
      missingFieldsOnForm.map(d => `• ${d}`).join("\n") +
      `\n\nPlease contact your system administrator.`;

    await Xrm.Navigation.openAlertDialog({ title: `${entityDisplayName} Form Configuration`, text: msg }, { width: 520 });
    // Do not attempt to auto-save on config errors
    return true; // treat as failing validation
  }

  // Missing data warning
  if (missingDataFields.length > 0) {
    let warningMessage =
      `The following required fields are missing data on the ${entityDisplayName} form:\n\n` +
      missingDataFields.map(d => `• ${d}`).join("\n");

    if (contextMessage) warningMessage += `\n\n${contextMessage}`;

    await Xrm.Navigation.openAlertDialog({ title: dialogTitle, text: warningMessage }, { width: 520 });

    // Compact banner (single-line)
    formContext.ui.setFormNotification(
      `Missing Data: ${missingDataFields.join(", ")}`,
      "ERROR",
      notifId
    );

    // Keep save blocked (preventDefault already called above)
    return true;
  }

  // All good — clear banner and, if we intercepted a save, re-save once
  if (blockSave) {
    formContext._bypassValidation = true;
    formContext.data.entity.save();
  }
  return false;
}


/**
 * Checks if specified fields have data in a related entity record
 * @param {object}  executionContext  Form execution context
 * @param {string}  lookupFieldName   Schema name of the lookup field on current form
 * @param {string}  targetEntityName  Logical name of the target entity to validate (e.g., "contact")
 * @param {object|string} fieldMapping Object (or JSON string) mapping field schema names -> display names
 * @param {string}  entityDisplayName Display name of the target entity (e.g., "Client")
 * @param {string}  dialogTitle       Optional dialog title (supports \n via escaping)
 * @param {string}  contextMessage    Optional extra message (supports \n via escaping)
 * @param {boolean} blockSave         If true, prevent save when data missing and enforce before-save validation
 * @returns {Promise<boolean>}        Resolves true if data missing, false if all present or validation skipped
 */
async function checkRelatedEntityData(
  executionContext,
  lookupFieldName,
  targetEntityName,
  fieldMapping,
  entityDisplayName,
  dialogTitle = "",
  contextMessage = "",
  blockSave = false
) {
  const formContext = executionContext.getFormContext();
  console.log("checkRelatedEntityData triggered for", targetEntityName);

  if (!formContext) {
    console.error("Form context not found");
    return false;
  }

  // Helper: turn literal "\n" typed in handler params into real newlines
  function normalizeMsg(s) {
    if (typeof s !== "string") return "";
    return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  // Parse mapping if it arrived as a JSON string from the handler box
  if (typeof fieldMapping === "string") {
    try { fieldMapping = JSON.parse(fieldMapping); }
    catch (e) {
      console.error("fieldMapping must be valid JSON", e);
      return false;
    }
  }

  if (!fieldMapping || typeof fieldMapping !== "object") {
    console.error("Invalid fieldMapping parameter. Must be an object or JSON string.");
    return false;
  }

  const fieldsToCheck = Object.keys(fieldMapping);
  if (fieldsToCheck.length === 0) {
    console.warn("No fields provided in fieldMapping.");
    return false;
  }

  dialogTitle = normalizeMsg(dialogTitle);
  contextMessage = normalizeMsg(contextMessage);

  // Lookup value
  const lookupAttr = formContext.getAttribute(lookupFieldName);
  if (!lookupAttr) {
    console.error("Lookup field not found:", lookupFieldName);
    return false;
  }
  const lookupValue = lookupAttr.getValue();
  if (!lookupValue || lookupValue.length === 0) {
    console.warn("No related record selected in lookup:", lookupFieldName);
    return false;
  }
  const recordId = (lookupValue[0].id || "").replace(/[{}]/g, "");

  // --- Save-blocking guard (prevents infinite loop on re-save) ---
  if (blockSave) {
    // If we're in the re-save pass, consume the bypass flag and allow save
    if (formContext._bypassValidation) {
      delete formContext._bypassValidation;
      return false;
    }
    const args = executionContext.getEventArgs && executionContext.getEventArgs();
    if (args && typeof args.preventDefault === "function") {
      args.preventDefault(); // stop the current save while we validate asynchronously
    }
  }

  // Build select list for retrieveRecord
  const select = fieldsToCheck.join(",");
  const query = select ? `?$select=${select}` : "";

  // Helpers to read values and to decide "missing"
  const getValue = (rec, name) =>
    rec[name] !== undefined ? rec[name] : rec["_" + name + "_value"]; // lookup raw GUID is _name_value

  const isMissing = (v) => {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;  // multi-selects
    if (typeof v === "string") return v.trim() === "";
    // numbers, booleans, dates -> considered present if defined
    return false;
  };

  const notifId = "missingDataError_" + targetEntityName;

  try {
    const record = await Xrm.WebApi.retrieveRecord(targetEntityName, recordId, query);

    const missingFields = [];
    for (const fieldName of fieldsToCheck) {
      const val = getValue(record, fieldName);
      if (isMissing(val)) missingFields.push(fieldName);
    }

    // Clear any old notification before setting a new one
    formContext.ui.clearFormNotification(notifId);

    if (missingFields.length > 0) {
      const missingDisplayNames = missingFields.map((f) => fieldMapping[f] || f);

      // Compose multi-line dialog text
      let warningMessage =
        "The following required fields are missing data in the " + entityDisplayName + " record:\n\n" +
        missingDisplayNames.map((d) => "• " + d).join("\n");

      if (contextMessage) warningMessage += "\n\n" + contextMessage;

      // UCI-styled dialog (respects \n)
      await Xrm.Navigation.openAlertDialog(
        { title: dialogTitle || `Missing ${entityDisplayName} Data`, text: warningMessage },
        { width: 520 }
      );

      // Compact, single-line banner
      formContext.ui.setFormNotification(
        `Missing Data: ${missingDisplayNames.join(", ")}`,
        "ERROR",
        notifId
      );

      // Keep save blocked (we already prevented default above)
      return true; // data missing
    }

    // All good: clear banner and, if we intercepted a save, re-save once
    if (blockSave) {
      formContext._bypassValidation = true; // allow the next save to pass without re-blocking
      formContext.data.entity.save();
    }
    return false; // no data missing
  } catch (error) {
    console.error("Error retrieving related record:", error && error.message ? error.message : error);

    // Show a clear error and keep save blocked (safer default)
    await Xrm.Navigation.openAlertDialog({
      title: dialogTitle || `Validation Error — ${entityDisplayName}`,
      text: `Could not validate ${entityDisplayName} data. Please try again.\n\nDetails: ${error.message || error}`
    });

    formContext.ui.setFormNotification(
      `Could not validate ${entityDisplayName} data. Try again.`,
      "ERROR",
      notifId
    );

    return false; // treat as not validated; do not auto-save on error
  }
}

/**
 * Checks if specified fields have data on the current record (retrieves from database)
 * This approach works regardless of which tab fields are on or if they're even on the form
 * @param {object}  executionContext  - Form execution context
 * @param {string}  dialogTitle       - Dialog title (supports \n via escaping)
 * @param {object|string} fieldMapping- Object (or JSON string) mapping field schema names -> display names
 * @param {string}  entityDisplayName - Display name of the entity
 * @param {string}  contextMessage    - Optional additional context (supports \n via escaping)
 * @param {boolean} blockSave         - Prevent save if fields are missing (default: false)
 * @returns {Promise<boolean>}        - true if any fields are missing data; false otherwise
 */
async function checkRequiredFieldsHaveData(
  executionContext,
  dialogTitle,
  fieldMapping,
  entityDisplayName,
  contextMessage,
  blockSave = false
) {
  const formContext = executionContext.getFormContext();
  if (!formContext) {
    console.error("Form context not found!");
    return false;
  }

  // --- helpers ---
  const notifId = "missingDataError_current";

  function normalizeMsg(s) {
    if (typeof s !== "string") return "";
    return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  function isMissing(v) {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.length === 0;       // multi-selects
    if (typeof v === "string") return v.trim() === ""; // strings
    // numbers (0), booleans (false), Date objects are considered present if defined
    return false;
  }

  // Helper to read values from retrieved record (handles lookups)
  const getValue = (rec, name) =>
    rec[name] !== undefined ? rec[name] : rec["_" + name + "_value"];

  // Parse mapping if passed as JSON string in handler box
  if (typeof fieldMapping === "string") {
    try { fieldMapping = JSON.parse(fieldMapping); }
    catch (e) {
      console.error("fieldMapping must be valid JSON", e);
      return false;
    }
  }
  if (!fieldMapping || typeof fieldMapping !== "object") {
    console.error("Invalid fieldMapping parameter. Must be an object or JSON string.");
    return false;
  }

  dialogTitle    = normalizeMsg(dialogTitle)    || `Missing ${entityDisplayName} Data`;
  contextMessage = normalizeMsg(contextMessage);

  const fieldsToCheck = Object.keys(fieldMapping);
  if (fieldsToCheck.length === 0) {
    console.warn("No fields provided in fieldMapping.");
    return false;
  }

  // Get current record ID and entity name
  const entityName = formContext.data.entity.getEntityName();
  const recordId = formContext.data.entity.getId().replace(/[{}]/g, "");

  if (!recordId) {
    console.warn("No record ID found - this may be a new record.");
    return false; // Can't validate unsaved records via WebAPI
  }

  // --- Save-blocking guard (prevents infinite loop on re-save) ---
  if (blockSave) {
    if (formContext._bypassValidation) {
      delete formContext._bypassValidation;
      return false;
    }
    const args = executionContext.getEventArgs && executionContext.getEventArgs();
    if (args && typeof args.preventDefault === "function") {
      args.preventDefault();
    }
  }

  // Build select list for retrieveRecord
  const select = fieldsToCheck.join(",");
  const query = select ? `?$select=${select}` : "";

  // Clear any prior notifications
  formContext.ui.clearFormNotification(notifId);

  try {
    // Retrieve the current record from the database
    const record = await Xrm.WebApi.retrieveRecord(entityName, recordId, query);

    const missingDataFields = [];

    for (const fieldName of fieldsToCheck) {
      const display = fieldMapping[fieldName] || fieldName;
      const value = getValue(record, fieldName);

      if (isMissing(value)) {
        console.warn("Field missing data:", fieldName);
        missingDataFields.push(display);
      }
    }

    // Missing data warning
    if (missingDataFields.length > 0) {
      let warningMessage =
        `The following required fields are missing data on the ${entityDisplayName} record:\n\n` +
        missingDataFields.map(d => `• ${d}`).join("\n");

      if (contextMessage) warningMessage += `\n\n${contextMessage}`;

      await Xrm.Navigation.openAlertDialog({ title: dialogTitle, text: warningMessage }, { width: 520 });

      // Compact banner (single-line)
      formContext.ui.setFormNotification(
        `Missing Data: ${missingDataFields.join(", ")}`,
        "ERROR",
        notifId
      );

      // Keep save blocked
      return true;
    }

    // All good — clear banner and, if we intercepted a save, re-save once
    if (blockSave) {
      formContext._bypassValidation = true;
      formContext.data.entity.save();
    }
    return false;

  } catch (error) {
    console.error("Error retrieving current record:", error && error.message ? error.message : error);

    // Show error dialog
    await Xrm.Navigation.openAlertDialog({
      title: dialogTitle || `Validation Error — ${entityDisplayName}`,
      text: `Could not validate ${entityDisplayName} data. Please try again.\n\nDetails: ${error.message || error}`
    });

    formContext.ui.setFormNotification(
      `Could not validate ${entityDisplayName} data. Try again.`,
      "ERROR",
      notifId
    );

    return false; // Don't auto-save on error
  }
}



/**
 * Check related records using the relationship directly
 * Use this if you know the lookup field name on the related entity
 * 
 * EXAMPLE EVENT HANDLER PARAMETERS:
 * Function: checkRelatedRecordsExistSimple
 * Parameters (comma-separated):
 * - "cp_patternofuse"                                    // Related entity logical name
 * - "cp_admission"                                       // Lookup field on RELATED ENTITY pointing to current record
 * - "cp_usetype"                                         // Choice field to check
 * - "{\"121570000\":\"Primary\",\"121570001\":\"Secondary\",\"121570002\":\"Other\"}"  // Required choice values (JSON)
 * - "Missing Pattern of Use Data"                        // Dialog title
 * - "Pattern of Use"                                     // Entity display name
 * - "Please ensure all addiction types are documented."  // Optional context message
 * - false                                                // blockSave (true/false)
 * 
 * @param {object}  executionContext          - Form execution context
 * @param {string}  relatedEntityName         - Logical name of related entity (e.g., "cp_patternofuse")
 * @param {string}  lookupFieldToCurrentEntity - Schema name of lookup on RELATED entity pointing to current record (e.g., "cp_admission")
 * @param {string}  choiceFieldName           - Schema name of the choice field to check (e.g., "cp_usetype")
 * @param {object|string} requiredChoices     - Object mapping choice values -> display names, or JSON string
 * @param {string}  dialogTitle               - Dialog title (supports \n via escaping)
 * @param {string}  entityDisplayName         - Display name for the related entity (e.g., "Pattern of Use")
 * @param {string}  contextMessage            - Optional additional context (supports \n via escaping)
 * @param {boolean} blockSave                 - Prevent save if records are missing (default: false)
 * @returns {Promise<boolean>}                - true if any required records are missing; false otherwise
 */
async function checkRelatedRecordsExistSimple(
  executionContext,
  relatedEntityName,
  lookupFieldToCurrentEntity,
  choiceFieldName,
  requiredChoices,
  dialogTitle,
  entityDisplayName,
  contextMessage = "",
  blockSave = false
) {
  const formContext = executionContext.getFormContext();
  
  if (!formContext) {
    console.error("Form context not found");
    return false;
  }

  function normalizeMsg(s) {
    if (typeof s !== "string") return "";
    return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  if (typeof requiredChoices === "string") {
    try { requiredChoices = JSON.parse(requiredChoices); }
    catch (e) {
      console.error("requiredChoices must be valid JSON", e);
      return false;
    }
  }

  dialogTitle = normalizeMsg(dialogTitle) || `Missing ${entityDisplayName} Records`;
  contextMessage = normalizeMsg(contextMessage);

  const requiredValues = Object.keys(requiredChoices);
  const recordId = formContext.data.entity.getId().replace(/[{}]/g, "");

  if (!recordId) {
    console.warn("No record ID found.");
    return false;
  }

  if (blockSave) {
    if (formContext._bypassValidation) {
      delete formContext._bypassValidation;
      return false;
    }
    const args = executionContext.getEventArgs && executionContext.getEventArgs();
    if (args && typeof args.preventDefault === "function") {
      args.preventDefault();
    }
  }

  const notifId = "missingRelatedRecords_" + relatedEntityName;
  formContext.ui.clearFormNotification(notifId);

  try {
    // Query related records filtering by the lookup to current record
    const filter = `?$filter=_${lookupFieldToCurrentEntity}_value eq ${recordId}&$select=${choiceFieldName}`;
    const result = await Xrm.WebApi.retrieveMultipleRecords(relatedEntityName, filter);

    const foundValues = new Set();
    if (result && result.entities) {
      result.entities.forEach(record => {
        const choiceValue = record[choiceFieldName];
        if (choiceValue !== null && choiceValue !== undefined) {
          foundValues.add(choiceValue.toString());
        }
      });
    }

    const missingValues = requiredValues.filter(value => !foundValues.has(value));

    if (missingValues.length > 0) {
      const missingDisplayNames = missingValues.map(v => requiredChoices[v] || v);

      let warningMessage =
        `The following ${entityDisplayName} records are missing:\n\n` +
        missingDisplayNames.map(d => `• ${d}`).join("\n");

      if (contextMessage) warningMessage += `\n\n${contextMessage}`;

      await Xrm.Navigation.openAlertDialog(
        { title: dialogTitle, text: warningMessage },
        { width: 520 }
      );

      formContext.ui.setFormNotification(
        `Missing ${entityDisplayName}: ${missingDisplayNames.join(", ")}`,
        "ERROR",
        notifId
      );

      return true;
    }

    if (blockSave) {
      formContext._bypassValidation = true;
      formContext.data.entity.save();
    }
    return false;

  } catch (error) {
    console.error("Error retrieving related records:", error && error.message ? error.message : error);

    await Xrm.Navigation.openAlertDialog({
      title: dialogTitle || `Validation Error — ${entityDisplayName}`,
      text: `Could not validate ${entityDisplayName} records. Please try again.\n\nDetails: ${error.message || error}`
    });

    formContext.ui.setFormNotification(
      `Could not validate ${entityDisplayName} records. Try again.`,
      "ERROR",
      notifId
    );

    return false;
  }
}


/**
 * Validate a PHN field on a Dataverse form.
 * Shows UCI alert dialog + form banner + field notification, and can block save.
 *
 * @param {object}  executionContext   Form execution context
 * @param {string}  fieldName          Schema name of the PHN field (default: "cp_ahcnumber")
 * @param {boolean} blockSave          If true, prevent save when invalid (default: false)
 * @param {boolean} autoFormat         If true, auto-format 9 digits to #####-#### (default: false)
 */
function validatePHNField(
  executionContext,
  fieldName = "cp_ahcnumber",
  blockSave = false,
  autoFormat = false
) {
  const formContext = executionContext.getFormContext();
  const attr = formContext.getAttribute(fieldName);
  const ctrl = formContext.getControl(fieldName);
  const notifId = "phn_invalid_" + fieldName;

  if (!attr || !ctrl) {
    console.warn("PHN field not found:", fieldName);
    return true; // treat as valid to avoid blocking accidentally
  }

  // normalize whitespace; allow user to type spaces but ignore them
  let raw = (attr.getValue() || "").toString().trim();
  const compact = raw.replace(/\s+/g, ""); // remove spaces for testing/formatting

  // Accept either ######### OR #####-####
  const regex = /^(\d{9}|\d{5}-\d{4})$/;

  // Optional: auto-format 9 digits -> #####-####
  if (autoFormat && /^\d{9}$/.test(compact)) {
    const formatted = compact.replace(/(\d{5})(\d{4})/, "$1-$2");
    if (formatted !== raw) {
      attr.setValue(formatted);
      raw = formatted;
    }
  }

  // Clear prior notifications
  ctrl.clearNotification(notifId);
  formContext.ui.clearFormNotification(notifId);

  const isValid = regex.test(raw);
  if (isValid) return true;

  // Compose messages
  const dialogTitle = "Invalid PHN Format";
  const dialogText =
    "Please enter the Personal Health Number in one of the following formats:\n\n" +
    "• 9 digits (#########)\n" +
    "• 5 digits, a dash, 4 digits (#####-####)\n\n" +
    "Letters are not allowed.";

  // Field-level notification and focus for quick correction
  ctrl.setNotification("Invalid PHN. Use ######### or #####-#### (numbers only).", notifId);
  ctrl.setFocus();

  // Form banner (compact)
  formContext.ui.setFormNotification("Invalid PHN format.", "ERROR", notifId);

  // UCI alert dialog
  Xrm.Navigation.openAlertDialog({ title: dialogTitle, text: dialogText }, { width: 520 });

  // Optionally block save
  if (blockSave) {
    const args = executionContext.getEventArgs && executionContext.getEventArgs();
    if (args && typeof args.preventDefault === "function") {
      args.preventDefault();
    }
  }

  return false;
}