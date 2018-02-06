import { management } from 'ui/management';
import 'plugins/investigate_core/management/sections/kibi_virtual_indices/controllers/virtual_indices_controller';
import 'plugins/investigate_core/management/sections/kibi_virtual_indices/directives/saved_virtual_indices_finder';

management.getSection('kibana').register('virtualindexes', {
  display: 'Virtual Indexes',
  order: 16,
  url: '#/management/siren/virtualindexes'
});