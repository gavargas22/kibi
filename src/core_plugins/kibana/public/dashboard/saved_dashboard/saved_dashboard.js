import angular from 'angular';
import _ from 'lodash';
import { uiModules } from 'ui/modules';
const module = uiModules.get('app/dashboard');

// Used only by the savedDashboards service, usually no reason to change this
module.factory('SavedDashboard', function (courier, config) {
  // SavedDashboard constructor. Usually you'd interact with an instance of this.
  // ID is option, without it one will be generated on save.
  _.class(SavedDashboard).inherits(courier.SavedObject);
  function SavedDashboard(id) {
    // Gives our SavedDashboard the properties of a SavedObject
    SavedDashboard.Super.call(this, {
      type: SavedDashboard.type,
      mapping: SavedDashboard.mapping,
      searchSource: SavedDashboard.searchsource,

      // if this is null/undefined then the SavedObject will be assigned the defaults
      id: id,

      // default values that will get assigned if the doc is new
      defaults: {
        title: 'New Dashboard',
        hits: 0,
        description: '',
        panelsJSON: '[]',
        optionsJSON: angular.toJson({
          darkTheme: config.get('dashboard:defaultDarkTheme'),
          hideBorders: false //kibi: set it false as default
        }),
        uiStateJSON: '{}',
        version: 1,
        timeRestore: false,
        timeMode: undefined, // kibi: save the mode of the timepicker
        timeTo: undefined,
        timeFrom: undefined,
        refreshInterval: undefined,
        savedSearchId: undefined, // kibi: added to be able to store savedSearchId
        priority: 0 // kibi: added to sort dashboards
      },

      // if an indexPattern was saved with the searchsource of a SavedDashboard
      // object, clear it. It was a mistake
      clearSavedIndexPattern: true
    });
  }

  // save these objects with the 'dashboard' type
  SavedDashboard.type = 'dashboard';

  // if type:dashboard has no mapping, we push this mapping into ES
  SavedDashboard.mapping = {
    title: 'string',
    hits: 'integer',
    description: 'string',
    panelsJSON: 'string',
    optionsJSON: 'string',
    uiStateJSON: 'string',
    version: 'integer',
    timeRestore: 'boolean',
    // kibi: 'timeMode' is added to mapping
    timeMode: 'string',
    timeTo: 'string',
    timeFrom: 'string',
    refreshInterval: {
      type: 'object',
      properties: {
        display: { type: 'string' },
        pause: { type: 'boolean' },
        section: { type: 'integer' },
        value: { type: 'integer' }
      }
    },
    // kibi: 'savedSearchId' is added to mapping
    savedSearchId: 'string',
    priority: 'integer' // kibi: added to sort dashboards
  };

  // Order these fields to the top, the rest are alphabetical
  SavedDashboard.fieldOrder = ['title', 'description'];

  SavedDashboard.searchsource = true;

  return SavedDashboard;
});
