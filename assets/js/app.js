(function () {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getElement(id) {
    if (typeof document === 'undefined' || !document.getElementById) {
      return null;
    }
    return document.getElementById(id);
  }

  function dispatchBracketActivated() {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      var event = typeof CustomEvent === 'function'
        ? new CustomEvent('anteraja:bracket-activated')
        : { type: 'anteraja:bracket-activated' };
      window.dispatchEvent(event);
    }
  }

  function dispatchParticipantsUpdated() {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      var event = typeof CustomEvent === 'function'
        ? new CustomEvent('anteraja:participants-updated')
        : { type: 'anteraja:participants-updated' };
      window.dispatchEvent(event);
    }
  }

  var DIVISI_VALUES = [
    'Finance',
    'Human Capital x E-Fullfilment',
    'IT PMTI x Brand & Business Ecosystem',
    'IT Development',
    'IT Operation x IT Service & Project Coordination',
    'BOMS',
    'Sales, Growth and Customer Experience',
    'Operation',
    'BPRM x Internal Audit & Anti Fraud',
    'Other'
  ];

  function getKnownHcValue(participant) {
    var hc = participant && participant.hc != null ? String(participant.hc) : '';
    if (DIVISI_VALUES.indexOf(hc) !== -1) {
      return hc;
    }
    return '';
  }

  function hasMeaningfulParticipantData(participant) {
    if (!participant) {
      return false;
    }
    return !!(
      String(participant.phone || '').trim() ||
      String(participant.name || '').trim() ||
      String(participant.hc || '').trim() ||
      String(participant.hcCustom || '').trim() ||
      String(participant.status || '').trim()
    );
  }

  function sortByName(list, order) {
    return list.sort(function (left, right) {
      var leftName = String(left && left.name ? left.name : '').trim().toLowerCase();
      var rightName = String(right && right.name ? right.name : '').trim().toLowerCase();
      var leftPhone = String(left && left.phone ? left.phone : '').trim().toLowerCase();
      var rightPhone = String(right && right.phone ? right.phone : '').trim().toLowerCase();
      var direction = order === 'za' ? -1 : 1;

      if (!leftName && rightName) { return 1; }
      if (leftName && !rightName) { return -1; }
      if (leftName < rightName) { return -1 * direction; }
      if (leftName > rightName) { return 1 * direction; }
      if (leftPhone < rightPhone) { return -1 * direction; }
      if (leftPhone > rightPhone) { return 1 * direction; }
      return Number(left._sourceRow || 0) - Number(right._sourceRow || 0);
    });
  }

  // -- Bracket cascade-clear helpers (mirrors cascadeClearWinnerMut in BracketPage.jsx) --

  // Clear scores/winner of a match and propagate removal of winner to next round
  function cascadeClearMatchInBracket(bracket, roundIdx, matchIdx) {
    if (roundIdx + 1 >= bracket.rounds.length) return;
    var match = bracket.rounds[roundIdx][matchIdx];
    if (!match) return;

    var prevWinner = match.winner;
    match.score1 = '';
    match.score2 = '';
    match.winner = null;
    match.status = 'pending';

    if (prevWinner) {
      var nextMatchIdx = Math.floor(matchIdx / 2);
      var slot = matchIdx % 2 === 0 ? 'p1' : 'p2';
      var nextMatch = bracket.rounds[roundIdx + 1] && bracket.rounds[roundIdx + 1][nextMatchIdx];
      if (nextMatch && nextMatch[slot]) {
        nextMatch[slot] = null;
        cascadeClearMatchInBracket(bracket, roundIdx + 1, nextMatchIdx);
      }
    }
  }

  // Update participant name/hc in every bracket match where they appear (live rename)
  function updateParticipantInBracket(participantId, updatedParticipant) {
    if (!window.AnterajaStorage) return;
    var saved = AnterajaStorage.loadBracket();
    if (!saved || !saved.bracket || !Array.isArray(saved.bracket.rounds)) return;
    var bracket = saved.bracket;
    var changed = false;

    bracket.rounds.forEach(function (round) {
      round.forEach(function (match) {
        if (match.p1 && match.p1.id != null && String(match.p1.id) === String(participantId)) {
          match.p1.name = updatedParticipant.name;
          match.p1.hc   = updatedParticipant.hc;
          changed = true;
        }
        if (match.p2 && match.p2.id != null && String(match.p2.id) === String(participantId)) {
          match.p2.name = updatedParticipant.name;
          match.p2.hc   = updatedParticipant.hc;
          changed = true;
        }
        // Also update winner field if this participant won the match
        if (match.winner && match.winner.id != null && String(match.winner.id) === String(participantId)) {
          match.winner.name = updatedParticipant.name;
          match.winner.hc   = updatedParticipant.hc;
          changed = true;
        }
      });
    });

    if (changed) {
      AnterajaStorage.saveBracket({ bracket: bracket, liveMatchId: saved.liveMatchId });
      dispatchBracketActivated();
    }
  }

  // Remove a participant from every match they appear in and cascade-clear results
  function clearParticipantFromBracket(participantId) {
    if (!window.AnterajaStorage) return;
    var saved = AnterajaStorage.loadBracket();
    if (!saved || !saved.bracket || !Array.isArray(saved.bracket.rounds)) return;
    var bracket = saved.bracket;
    var changed = false;

    bracket.rounds.forEach(function (round, roundIdx) {
      round.forEach(function (match, matchIdx) {
        var cleared = false;
        if (match.p1 && match.p1.id != null && String(match.p1.id) === String(participantId)) {
          match.p1 = null;
          cleared = true;
        }
        if (match.p2 && match.p2.id != null && String(match.p2.id) === String(participantId)) {
          match.p2 = null;
          cleared = true;
        }
        if (cleared) {
          changed = true;
          cascadeClearMatchInBracket(bracket, roundIdx, matchIdx);
        }
      });
    });

    if (changed) {
      AnterajaStorage.saveBracket({ bracket: bracket, liveMatchId: saved.liveMatchId });
      dispatchBracketActivated();
    }
  }

  // Clear ALL real-participant references from every bracket match (used for delete-all)
  function clearAllParticipantsFromBracket() {
    if (!window.AnterajaStorage) return;
    var saved = AnterajaStorage.loadBracket();
    if (!saved || !saved.bracket || !Array.isArray(saved.bracket.rounds)) return;
    var bracket = saved.bracket;

    bracket.rounds.forEach(function (round) {
      round.forEach(function (match) {
        if (match.p1 && match.p1.id != null) match.p1 = null;
        if (match.p2 && match.p2.id != null) match.p2 = null;
        match.score1 = '';
        match.score2 = '';
        match.winner = null;
        match.status = 'pending';
      });
    });

    AnterajaStorage.saveBracket({ bracket: bracket, liveMatchId: saved.liveMatchId });
    dispatchBracketActivated();
  }

  var AnterajaApp = {
    participants: [],
    settings: null,
    sortOrder: 'default',
    _eventsWired: false,

    init: function () {
      if (typeof AnterajaStorage === 'undefined') {
        return;
      }
      this.tournament = AnterajaStorage.loadTournament();
      this.participants = AnterajaStorage.loadParticipants();
      this.settings = AnterajaStorage.loadSettings();
      this.sortOrder = 'default';
      this.renderTournamentSetup();
      this.renderParticipantTable();
      this.renderStats();
      this.wireEvents();
      document.querySelectorAll('.anteraja-section').forEach(function (s) {
        s.style.display = '';
        if (s.classList) s.classList.add('active');
      });
      AnterajaUI.updateHeader(this.tournament);
      try {
        var navDefault = document.querySelector('.sidebar-nav-item[data-section="dashboard"]');
        if (navDefault) navDefault.classList.add('active');
      } catch (err) {}
    },

    renderTournamentSetup: function () {
      var sizeInput = getElement('input-size');
      var tournament = this.tournament || AnterajaStorage.loadTournament();
      var size = parseInt(tournament.size, 10) || 32;

      var feeInput = getElement('input-fee');
      if (feeInput) {
        feeInput.value = typeof tournament.fee !== 'undefined' && tournament.fee !== null ? tournament.fee : '';
      }
      if (sizeInput) {
        sizeInput.value = String(size);
      }
    },

    getParticipantsForTable: function () {
      var size = parseInt(this.tournament && this.tournament.size, 10) || 32;
      var slotMap = {};
      var slotless = [];
      var ordered = [];
      var participants = Array.isArray(this.participants) ? this.participants.slice() : [];
      var i;

      for (i = 0; i < participants.length; i += 1) {
        if (participants[i] && Number(participants[i].slot) >= 1) {
          slotMap[Number(participants[i].slot)] = participants[i];
        } else {
          slotless.push(participants[i]);
        }
      }
      for (i = 1; i <= size; i += 1) {
        ordered.push(slotMap[i] || slotless[i - 1] || null);
      }
      if (this.sortOrder === 'az' || this.sortOrder === 'za') {
        ordered = sortByName(ordered.slice(), this.sortOrder);
      }
      return ordered;
    },

    renderParticipantTable: function () {
      var tbody = getElement('participant-tbody');
      var size = parseInt(this.tournament && this.tournament.size, 10) || 32;
      var rows = [];
      var participants = this.getParticipantsForTable();
      var i;

      if (!tbody) { return; }

      for (i = 1; i <= size; i += 1) {
        var participant = participants[i - 1] || null;
        var name = participant && participant.name ? participant.name : '';
        var hcValue = getKnownHcValue(participant);
        var status = participant && participant.status ? participant.status : '';
        var rowClass = status === 'cash' ? 'row-paid-cash' : (status === 'tf' ? 'row-paid-tf' : '');
        var cashActive = status === 'cash' ? 'active' : '';
        var tfActive = status === 'tf' ? 'active' : '';

        rows.push(
          '<tr id="row-' + i + '" data-row="' + i + '" data-current-status="' + escapeHtml(status) + '" class="' + rowClass + '">' +
            '<td class="row-number">' + i + '</td>' +
            '<td>' +
              '<div class="d-flex gap-1">' +
                '<button class="status-btn cash ' + cashActive + '" data-row="' + i + '" data-status="cash">' +
                  '<i class="fas fa-money-bill"></i> CASH' +
                '</button>' +
                '<button class="status-btn tf ' + tfActive + '" data-row="' + i + '" data-status="tf">' +
                  '<i class="fas fa-exchange-alt"></i> TF' +
                '</button>' +
              '</div>' +
            '</td>' +
            '<td>' +
              '<input type="text" class="table-input name-input" data-row="' + i + '" placeholder="Nama peserta..." value="' + escapeHtml(name) + '" maxlength="40"/>' +
            '</td>' +
            '<td>' +
              '<select class="table-select hc-select" data-row="' + i + '">' +
                '<option value="">— Pilih Divisi —</option>' +
                DIVISI_VALUES.map(function (divisi) {
                  return '<option value="' + escapeHtml(divisi) + '"' + (hcValue === divisi ? ' selected' : '') + '>' + escapeHtml(divisi) + '</option>';
                }).join('') +
              '</select>' +
            '</td>' +
            '<td>' +
              '<button class="btn-delete-row btn-export" data-row="' + i + '"><i class="fas fa-trash"></i></button>' +
            '</td>' +
          '</tr>'
        );
      }

      tbody.innerHTML = rows.join('');
    },

    renderStats: function () {
      var fee = parseFloat(this.tournament && this.tournament.fee) || 0;
      var participants = Array.isArray(this.participants) ? this.participants : [];
      var totalParticipants = participants.length;
      var cashCount = participants.filter(function (p) { return p && p.status === 'cash'; }).length;
      var tfCount = participants.filter(function (p) { return p && p.status === 'tf'; }).length;
      var bayarCashAmount = cashCount * fee;
      var transferAmount = tfCount * fee;
      var totalBayar = bayarCashAmount + transferAmount;
      var belumBayar = (totalParticipants * fee) - totalBayar;

      function setElText(id, value) {
        var el = getElement(id);
        if (!el) return;
        try { el.textContent = Number(value).toLocaleString(); } catch (e) { el.textContent = String(value); }
      }

      setElText('stat-bayar-cash', bayarCashAmount);
      setElText('stat-transfer', transferAmount);
      setElText('stat-total-bayar', totalBayar);
      setElText('stat-belum-bayar', belumBayar < 0 ? 0 : belumBayar);
      AnterajaUI.updateHeader(this.tournament);
    },

    wireEvents: function () {
      var self = this;

      if (this._eventsWired) { return; }
      this._eventsWired = true;

      document.querySelectorAll('.sidebar-nav-item').forEach(function (item) {
        item.addEventListener('click', function () {
          var section = item.dataset.section;
          document.querySelectorAll('.sidebar-nav-item').forEach(function (it) { it.classList.remove('active'); });
          item.classList.add('active');
          var el = document.getElementById('section-' + section);
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (section === 'statistics') self.renderStats();
          if (section === 'bracket') dispatchBracketActivated();
        });
      });

      var feeInputEl = getElement('input-fee');
      if (feeInputEl) {
        feeInputEl.addEventListener('input', function (e) {
          var fee = parseFloat(e.target.value) || 0;
          self.tournament.fee = fee;
          AnterajaStorage.saveTournament(self.tournament);
          self.renderStats();
        });
      }

      var inputSize = getElement('input-size');
      if (inputSize) {
        inputSize.addEventListener('change', function (e) {
          var size = parseInt(e.target.value, 10);
          self.tournament.size = size;
          AnterajaStorage.saveTournament(self.tournament);
          dispatchBracketActivated();
          self.renderParticipantTable();
          self.renderStats();
        });
      }

      var participantTbody = getElement('participant-tbody');
      if (participantTbody) {
        participantTbody.addEventListener('click', function (e) {
          var btn = (e.target && typeof e.target.closest === 'function') ? e.target.closest('.status-btn') : null;
          if (!btn) return;
          var rowIndex = parseInt(btn.dataset.row, 10);
          var status = btn.dataset.status;
          var row = getElement('row-' + rowIndex);
          var currentStatus = row ? row.dataset.currentStatus : '';
          var newStatus = currentStatus === status ? '' : status;

          if (row) {
            row.classList.remove('row-paid-cash', 'row-paid-tf');
            row.querySelectorAll('.status-btn').forEach(function (button) {
              button.classList.remove('active');
            });
          }
          if (newStatus === 'cash') {
            if (row) row.classList.add('row-paid-cash');
            btn.classList.add('active');
          } else if (newStatus === 'tf') {
            if (row) row.classList.add('row-paid-tf');
            btn.classList.add('active');
          }
          if (row) row.dataset.currentStatus = newStatus;

          var participant = self.getParticipantForRow(rowIndex);
          if (participant && participant.id) {
            participant.status = newStatus;
            AnterajaStorage.saveParticipant(participant);
            self.participants = AnterajaStorage.loadParticipants();
            self.renderStats();
          }
        });

      }

      var participantSearch = getElement('participant-search');
      if (participantSearch) {
        participantSearch.addEventListener('input', function (e) {
          var query = e.target.value.toLowerCase();
          document.querySelectorAll('#participant-tbody tr').forEach(function (row) {
            var name = row.querySelector('.name-input') && row.querySelector('.name-input').value.toLowerCase() || '';
            var visible = !query || name.indexOf(query) !== -1;
            row.style.display = visible ? '' : 'none';
          });
        });
      }

      var participantTbodyEl = getElement('participant-tbody');
      if (participantTbodyEl) {
        participantTbodyEl.addEventListener('input', function (e) {
          var t = e.target;
          if (t.matches('.name-input') || t.matches('.hc-select')) {
            var rowIndex = parseInt(t.dataset.row, 10);
            setTimeout(function () { self.saveParticipantRow(rowIndex); }, 140);
          }
        });

        participantTbodyEl.addEventListener('click', function (e) {
          var del = (e.target && typeof e.target.closest === 'function') ? e.target.closest('.btn-delete-row') : null;
          if (del) {
            var rowIndex = parseInt(del.dataset.row, 10);
            if (confirm('Hapus peserta ini?')) {
              clearParticipantFromBracket('row-' + rowIndex);
              AnterajaStorage.deleteParticipant('row-' + rowIndex);
              self.participants = AnterajaStorage.loadParticipants();
              self.renderParticipantTable();
              self.renderStats();
              dispatchParticipantsUpdated();
              if (typeof AnterajaUI !== 'undefined') AnterajaUI.showToast('Peserta dihapus', 'success');
            }
          }
        });
      }

      var sortAzBtn = getElement('btn-sort-az');
      if (sortAzBtn) {
        sortAzBtn.addEventListener('click', function () { self.sortParticipants('az'); });
      }

      var sortZaBtn = getElement('btn-sort-za');
      if (sortZaBtn) {
        sortZaBtn.addEventListener('click', function () { self.sortParticipants('za'); });
      }

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('storage', function (evt) {
          try {
            var key = evt.key;
            if (!key) return;
            var interesting = ['anteraja_participants', 'anteraja_tournament', 'anteraja_settings'];
            if (interesting.indexOf(key) === -1) return;
            try { self.tournament = AnterajaStorage.loadTournament(); } catch (e) {}
            try { self.participants = AnterajaStorage.loadParticipants(); } catch (e) {}
            try { self.settings = AnterajaStorage.loadSettings(); } catch (e) {}
            try { self.renderParticipantTable(); self.renderStats(); } catch (e) {}
          } catch (err) {}
        });
      }

      var resetAllBtn = getElement('btn-reset-all');
      if (resetAllBtn) {
        resetAllBtn.addEventListener('click', function () {
          if (confirm('RESET SEMUA DATA? Tindakan ini tidak dapat dibatalkan!')) {
            AnterajaStorage.clearAll();
            location.reload();
          }
        });
      }

      var deleteAllBtn = getElement('btn-delete-all');
      if (deleteAllBtn) {
        deleteAllBtn.addEventListener('click', function () {
          if (confirm('Hapus semua peserta? Tindakan ini akan mengosongkan daftar peserta.')) {
            AnterajaStorage.saveParticipants([]);
            self.participants = [];
            self.renderParticipantTable();
            self.renderStats();
            dispatchParticipantsUpdated();
            clearAllParticipantsFromBracket();
            if (typeof AnterajaUI !== 'undefined') AnterajaUI.showToast('Semua peserta dihapus', 'success');
          }
        });
      }

      var exportExcelBtn = getElement('btn-export-excel');
      if (exportExcelBtn) {
        exportExcelBtn.addEventListener('click', function () { self.exportExcel(); });
      }

      var importExcelInput = getElement('import-excel-input');
      if (importExcelInput) {
        importExcelInput.addEventListener('change', function (e) {
          self.importExcel(e.target.files[0]);
          e.target.value = '';
        });
      }

      var importExcelTriggerBtn = getElement('btn-import-excel-trigger');
      if (importExcelTriggerBtn) {
        importExcelTriggerBtn.addEventListener('click', function () {
          if (importExcelInput) importExcelInput.click();
        });
      }

      var exportJsonBtn = getElement('btn-export-json');
      if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', function () { self.exportJSON(); });
      }

      var importJsonInput = getElement('import-json-input');
      if (importJsonInput) {
        importJsonInput.addEventListener('change', function (e) { self.importJSON(e.target.files[0]); });
      }

      // Preview bracket button
      var previewBtn = getElement('btn-preview-bracket');
      if (previewBtn) {
        previewBtn.addEventListener('click', function () {
          var saved      = window.AnterajaStorage ? AnterajaStorage.loadBracket()    : null;
          var tournament = window.AnterajaStorage ? AnterajaStorage.loadTournament() : {};
          var payloadObj = {
            bracket:      saved && saved.bracket      ? saved.bracket      : null,
            liveMatchIds: saved && saved.liveMatchIds ? saved.liveMatchIds : [],
            tournament:   tournament
          };

          if (window.BilposFirebase) {
            BilposFirebase.openPreview(payloadObj);
          } else {
            // Fallback: hash-based URL
            var compressed = window.LZString
              ? LZString.compressToEncodedURIComponent(JSON.stringify(payloadObj))
              : encodeURIComponent(JSON.stringify(payloadObj));
            window.open('preview.html#' + compressed, '_blank');
          }
        });
      }
    },

    getParticipantForRow: function (rowIndex) {
      var participantId = 'row-' + rowIndex;
      var found = (this.participants || []).find(function (participant) {
        return participant && participant.id === participantId;
      });
      return found || {
        id: participantId,
        slot: parseInt(rowIndex, 10),
        phone: '',
        name: '',
        hc: '',
        hcCustom: '',
        status: ''
      };
    },

    collectTableRows: function () {
      var size = parseInt(this.tournament && this.tournament.size, 10) || 32;
      var rows = [];
      var i;
      for (i = 1; i <= size; i += 1) {
        var name = document.querySelector('.name-input[data-row="' + i + '"]');
        var hcSelectEl = document.querySelector('.hc-select[data-row="' + i + '"]');
        var rowEl = getElement('row-' + i);
        var hc = hcSelectEl ? hcSelectEl.value : '';
        var existingParticipant = (this.participants || []).find(function (p) { return p && p.id === 'row-' + i; });
        var phoneValue = existingParticipant ? (existingParticipant.phone || '') : '';
        rows.push({
          id: 'row-' + i,
          slot: i,
          phone: phoneValue,
          name: name ? name.value.trim() : '',
          hc: hc,
          hcCustom: '',
          status: rowEl ? rowEl.dataset.currentStatus || '' : '',
          _sourceRow: i
        });
      }
      return rows;
    },

    sortParticipants: function (order) {
      var rows = this.collectTableRows();
      var meaningfulRows = rows.filter(hasMeaningfulParticipantData);
      var sortedRows = sortByName(meaningfulRows.slice(), order);
      var savedParticipants = [];
      var i;
      this.sortOrder = order;
      for (i = 0; i < sortedRows.length; i += 1) {
        savedParticipants.push({
          id: 'row-' + (i + 1),
          slot: i + 1,
          phone: sortedRows[i].phone,
          name: sortedRows[i].name,
          hc: sortedRows[i].hc,
          hcCustom: sortedRows[i].hcCustom,
          status: sortedRows[i].status
        });
      }
      AnterajaStorage.saveParticipants(savedParticipants);
      this.participants = AnterajaStorage.loadParticipants();
      this.renderParticipantTable();
      this.renderStats();
    },

    exportJSON: function () {
      var data = AnterajaStorage.exportAll();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'anteraja-tournament-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(url);
      AnterajaUI.showToast('Data berhasil diekspor!', 'success');
    },

    importJSON: function (file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var data = JSON.parse(e.target.result);
          AnterajaStorage.importAll(data);
          AnterajaUI.showToast('Data berhasil diimpor!', 'success');
          setTimeout(function () { location.reload(); }, 1000);
        } catch (err) {
          AnterajaUI.showToast('File JSON tidak valid!', 'danger');
        }
      };
      reader.readAsText(file);
    },

    // Slot (1-based) -> bracket label, e.g. slot 1 -> '1A', slot 2 -> '1B', slot 3 -> '2A', slot 4 -> '2B'
    slotToBracketLabel: function (slot) {
      var matchNumber = Math.ceil(slot / 2);
      var position = (slot % 2 === 1) ? 'A' : 'B';
      return matchNumber + position;
    },

    // Bracket label (e.g. '1A', '2B') -> slot (1-based). Returns null if invalid.
    bracketLabelToSlot: function (label) {
      var match = String(label == null ? '' : label).trim().toUpperCase().match(/^(\d+)\s*([AB])$/);
      if (!match) return null;
      var matchNumber = parseInt(match[1], 10);
      var position = match[2];
      if (!matchNumber || matchNumber < 1) return null;
      return (matchNumber * 2) - (position === 'A' ? 1 : 0);
    },

    // Get the divisi label for a participant, respecting the "custom" HC override (hcCustom).
    getDivisiLabel: function (p) {
      if (!p) return '';
      var hc = String(p.hc || '').trim();
      var custom = String(p.hcCustom || '').trim();
      if (hc === 'custom' || custom) return custom || hc;
      return hc;
    },

    exportExcel: function () {
      if (typeof XLSX === 'undefined') {
        AnterajaUI.showToast('Library Excel tidak tersedia', 'danger');
        return;
      }
      var self = this;
      var size = parseInt(this.tournament && this.tournament.size, 10) || 32;
      var rows = [];
      var savedBracket = AnterajaStorage.loadBracket();
      var round0 = savedBracket && savedBracket.bracket && savedBracket.bracket.size === size
        && Array.isArray(savedBracket.bracket.rounds) ? savedBracket.bracket.rounds[0] : null;

      function getNama(p) {
        if (!p || !p.name || p.name === 'BYE') return '';
        return p.name;
      }

      if (round0 && round0.length) {
        // Export exactly what is shown in the Tournament Bracket (Match #N, top = A, bottom = B).
        round0.forEach(function (match, matchIdx) {
          var matchNumber = matchIdx + 1;
          rows.push({
            'Nama': getNama(match.p1),
            'Divisi': self.getDivisiLabel(match.p1),
            'Bracket': matchNumber + 'A',
            'Ukuran Tournament': size
          });
          rows.push({
            'Nama': getNama(match.p2),
            'Divisi': self.getDivisiLabel(match.p2),
            'Bracket': matchNumber + 'B',
            'Ukuran Tournament': size
          });
        });
      } else {
        // Fallback: no bracket generated yet, export using the List Peserta table order.
        var participants = self.getParticipantsForTable();
        var i;
        for (i = 1; i <= size; i += 1) {
          var participant = participants[i - 1] || null;
          rows.push({
            'Nama': (participant && participant.name) || '',
            'Divisi': self.getDivisiLabel(participant),
            'Bracket': self.slotToBracketLabel(i),
            'Ukuran Tournament': size
          });
        }
      }

      var wb = XLSX.utils.book_new();
      var ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Peserta');
      XLSX.writeFile(wb, 'anteraja-peserta-' + new Date().toISOString().slice(0, 10) + '.xlsx');
      AnterajaUI.showToast('Excel berhasil diekspor!', 'success');
    },

    importExcel: function (file) {
      if (!file || typeof XLSX === 'undefined') {
        AnterajaUI.showToast('File atau library tidak tersedia', 'danger');
        return;
      }
      var self = this;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var wb = XLSX.read(e.target.result, { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws);
          var existingParticipants = AnterajaStorage.loadParticipants();
          var skipped = 0;

          var VALID_SIZES = [4, 8, 16, 32, 64, 128];
          // Round up to the smallest supported tournament size that can fit `value` slots.
          function normalizeSize(value) {
            var n = parseInt(value, 10) || 0;
            for (var i = 0; i < VALID_SIZES.length; i += 1) {
              if (VALID_SIZES[i] >= n) return VALID_SIZES[i];
            }
            return VALID_SIZES[VALID_SIZES.length - 1];
          }

          // Determine tournament size from the "Ukuran Tournament" column (first valid value found)...
          var sizeFromColumn = 0;
          rows.forEach(function (row) {
            if (sizeFromColumn) return;
            var raw = row['Ukuran Tournament'] || row['ukuran tournament'] || row['Ukuran'] || row['Size'] || '';
            var parsed = parseInt(raw, 10);
            if (parsed > 0) sizeFromColumn = parsed;
          });

          // ...and cross-check against the highest bracket slot actually used in the sheet,
          // so the tournament size always fits every imported bracket number (e.g. 17A/17B).
          var maxSlotFromBracket = 0;
          rows.forEach(function (row) {
            var bracketLabel = row['Bracket'] || row['bracket'] || row['No Bracket'] || row['Nomor Bracket'] || '';
            var slot = self.bracketLabelToSlot(bracketLabel);
            if (slot && slot > maxSlotFromBracket) maxSlotFromBracket = slot;
          });

          var size = normalizeSize(Math.max(sizeFromColumn, maxSlotFromBracket) || (parseInt(self.tournament && self.tournament.size, 10) || 32));

          self.tournament = AnterajaStorage.saveTournament(Object.assign({}, self.tournament, { size: size }));

          var participantsForBracket = [];

          rows.forEach(function (row) {
            var bracketLabel = row['Bracket'] || row['bracket'] || row['No Bracket'] || row['Nomor Bracket'] || '';
            var slot = self.bracketLabelToSlot(bracketLabel);
            if (!slot || slot > size) {
              skipped += 1;
              return;
            }
            var name = String(row['Nama'] || row['nama'] || '').trim();
            var hc = String(row['Divisi'] || row['divisi'] || row['HC'] || '').trim();
            if (!name && !hc) {
              return;
            }
            var existing = existingParticipants.find(function (p) { return p && p.id === 'row-' + slot; });
            var p = {
              id: 'row-' + slot,
              slot: slot,
              phone: existing ? (existing.phone || '') : '',
              name: name,
              hc: hc,
              hcCustom: '',
              status: existing ? (existing.status || '') : ''
            };
            AnterajaStorage.saveParticipant(p);
            if (name) {
              participantsForBracket.push({ id: p.id, name: p.name, hc: p.hc, drawingNumber: slot });
            }
          });

          // Regenerate the tournament bracket so round 1 reflects the imported bracket numbers.
          if (typeof AnterajaTournament !== 'undefined') {
            var newBracket = AnterajaTournament.generateBracket(size, participantsForBracket);
            AnterajaStorage.saveBracket({ bracket: newBracket, liveMatchIds: [] });
          }

          // Apply immediately so the UI reflects the new size/participants/bracket without waiting for reload.
          self.participants = AnterajaStorage.loadParticipants();
          self.renderTournamentSetup();
          self.renderParticipantTable();
          self.renderStats();
          dispatchParticipantsUpdated();
          dispatchBracketActivated();

          if (skipped > 0) {
            AnterajaUI.showToast('Excel diimpor, ' + skipped + ' baris dilewati (kolom Bracket tidak valid)', 'success');
          } else {
            AnterajaUI.showToast('Excel berhasil diimpor!', 'success');
          }
          setTimeout(function () { location.reload(); }, 1000);
        } catch (err) {
          AnterajaUI.showToast('Gagal membaca file Excel!', 'danger');
        }
      };
      reader.readAsArrayBuffer(file);
    },

    saveParticipantRow: function (rowIndex) {
      rowIndex = parseInt(rowIndex, 10);
      var name = document.querySelector('.name-input[data-row="' + rowIndex + '"]') && document.querySelector('.name-input[data-row="' + rowIndex + '"]').value.trim() || '';
      var hcSelectEl = document.querySelector('.hc-select[data-row="' + rowIndex + '"]');
      var hc = hcSelectEl && hcSelectEl.value || '';
      var row = getElement('row-' + rowIndex);
      var status = row && row.dataset.currentStatus || '';
      var existingParticipant = (this.participants || []).find(function (p) { return p && p.id === 'row-' + rowIndex; });
      var phone = existingParticipant ? (existingParticipant.phone || '') : '';
      var oldName = existingParticipant ? (existingParticipant.name || '') : '';

      var participant = {
        id: 'row-' + rowIndex,
        slot: rowIndex,
        phone: phone,
        name: name,
        hc: hc,
        hcCustom: '',
        status: status
      };

      AnterajaStorage.saveParticipant(participant);
      this.participants = AnterajaStorage.loadParticipants();
      this.renderStats();
      dispatchParticipantsUpdated();

      // If name or HC changed, update in-place inside bracket (no clearing)
      if (existingParticipant && (name !== oldName || hc !== (existingParticipant.hc || ''))) {
        updateParticipantInBracket('row-' + rowIndex, participant);
      }
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    AnterajaApp.init();
  });

  if (typeof window !== 'undefined') {
    window.AnterajaApp = AnterajaApp;
  }
})();
