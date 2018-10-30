/******************************************************************************
This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.

Orignal Author: Gopi Sankar Karmegam
******************************************************************************/

/* Ugly. This is here so that we don't crash old libnm-glib based shells unnecessarily
 * by loading the new libnm.so. Should go away eventually */
const libnm_glib = imports.gi.GIRepository.Repository.get_default().is_registered("NMClient", "1.0");

const Lang = imports.lang;
const Main = imports.ui.main;
const NM = libnm_glib ? imports.gi.NetworkManager : imports.gi.NM;
const Mainloop = imports.mainloop;

const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const SignalManager = Convenience.SignalManager;
const Prefs = Me.imports.prefs;

const Gettext = imports.gettext.domain('disconnect-wifi');
const _ = Gettext.gettext;

function init() {
    Convenience.initTranslations("disconnect-wifi");
}

const RECONNECT_TEXT = "Reconnect"
const SPACE = " ";

const WifiDisconnector = new Lang.Class({
    Name : 'WifiDisconnector',
    _init : function() {
        this._nAttempts = 0;
        this._signalManager = new SignalManager();
        this._activeConnections = {};
        this._accessPoints = {};
        this._gsettings = Convenience.getSettings(Prefs.SETTINGS_SCHEMA);
        //Note: Make sure don't initialize anything after this
        this._checkDevices();
    },
    
    _checkDevices : function() {
    	if(this._timeoutId){
           Mainloop.source_remove(this._timeoutId);
           this._timeoutId = null;
        }
    	this._network = Main.panel.statusArea.aggregateMenu._network;
        if (this._network) {
            if (!this._network._client || (libnm_glib && !this._network._settings)) {
                // Shell not initialised completely wait for max of
                // 100 * 1 sec
                if (this._nAttempts++ < 100) {
                    this._timeoutId = Mainloop.timeout_add(1000, Lang.bind(this,
                            this._checkDevices));
                }
            } else {
                this._client = this._network._client;
                if (libnm_glib)
                    this._settings = this._network._settings;

                for (let device of this._network._nmDevices) {
                	this._deviceAdded(this._client, device);
                }
                this._signalManager.addSignal(this._client, 'device-added', 
                		Lang.bind(this, this._deviceAdded));
                this._signalManager.addSignal(this._client, 'device-removed', 
                		Lang.bind(this, this._deviceRemoved));
                this._signalManager.addSignal(this._gsettings,"changed::" + Prefs.SHOW_RECONNECT_ALWAYS,
                		Lang.bind(this,this._setDevicesReconnectVisibility) );
            }
        }
    },
    
    _deviceAdded : function(client, device) {
    	if (device.get_device_type() != NM.DeviceType.WIFI) {
            return;
        }
        if(device.active_connection) {
    		this._activeConnections[device] = device.active_connection;
    	}
        
        if(device.active_access_point) {
    		this._accessPoints[device] = device.active_access_point;
    	}
        this._addAllMenus(device);
    },
    
    _addAllMenus : function(device) {
    	if (device)
    	{
    		if (!device._delegate) {
    			if(!device.timeout) {
	    			device.timeout = Mainloop.timeout_add(1000, Lang.bind(this, function() {
	                    return this._addAllMenus(device);
	                }));
	                return true;
    			} else {
    				return true;
    			}
            }
    		
    		if(device.timeout) {
    			Mainloop.source_remove(device.timeout);
    			device.timeout = null;
    		}
    			
    		let wrapper = device._delegate;
        
	        if (!wrapper.disconnectItem) {
	            wrapper.disconnectItem 
	        		= wrapper.item.menu.addAction(_("Disconnect"), 
	                            function() {
	                                device.disconnect(null);
	                            });
	            wrapper.item.menu.moveMenuItem(wrapper.disconnectItem,2);
	        }
	        wrapper.disconnectItem.actor.visible = false;
	        
	        if (!wrapper.reconnectItem) {
	         	wrapper.reconnectItem
                    = wrapper.item.menu.addAction(_(RECONNECT_TEXT), 
                            Lang.bind(this, function() {
                                this._reconnect(device);
                            }));
	         	wrapper.item.menu.moveMenuItem(wrapper.reconnectItem,3);
	        }
	        
	        wrapper.reconnectItem.actor.visible = false;
	        
	        this._stateChanged(device, device.state, device.state, null);   
	        
	        this._signalManager.addSignal(device, 'state-changed', Lang.bind(this, this._stateChanged));	        
    	}
    	return false;
    },

    _reconnect : function(device) {
    	if(this._RtimeoutId){
           Mainloop.source_remove(this._RtimeoutId);
           this._RtimeoutId = null;
        }
    	global.log(device.state);
		
    	if(device.state > NM.DeviceState.DISCONNECTED){
    		if(device.state != NM.DeviceState.DEACTIVATING && device.state != NM.DeviceState.DISCONNECTING) {
    			device.disconnect(null);
    		}
    		let me = this;
    	    this._RtimeoutId = Mainloop.timeout_add(1000, function(){me._reconnect(device);});    	                
    	}
    	else {
	    	let _activeConnection = this._activeConnections[device];
	
	        if (libnm_glib) {
	            if (_activeConnection) {
	                this._client.activate_connection(
	                    this._settings.get_connection_by_path(_activeConnection.connection),
	                         device,null,null);
	            } else {
	                this._client.activate_connection(null,device,null,null);
	            }
	        } else {
	            if (_activeConnection) {
	                this._client.activate_connection_async(_activeConnection.connection,device,null,null,null);
	            } else {
	                this._client.activate_connection_async(null,device,null,null,null);
	            }
	        }
    	}
    },

    _stateChanged :  function(device, newstate, oldstate, reason) {
    	if (device.get_device_type() != NM.DeviceType.WIFI) {
            return;
        }
    	
    	if(device.active_connection) {
    		this._activeConnections[device] = device.active_connection;
    	}
    	
    	if(device.active_access_point) {
    		this._accessPoints[device] = device.active_access_point;
    	}
    	
    	if (!device._delegate) {
    		return;
    	}
    	
    	let wrapper = device._delegate;
    	if (wrapper.disconnectItem) {
    		wrapper.disconnectItem.actor.visible 
    			= newstate > NM.DeviceState.DISCONNECTED;
    	}
    	
    	this._setReconnectVisibility(device, newstate);
     },
     
     _setReconnectVisibility : function(device, state) {
    	 global.log("Device Current State: " + state);
    	 let wrapper = device._delegate;
    	 if (wrapper.reconnectItem) {
     		let showReconnect = this._gsettings.get_boolean(Prefs.SHOW_RECONNECT_ALWAYS);
     	                 
            let accessPoint = this._accessPoints[device];
            wrapper.reconnectItem.label.text = 
                     (accessPoint) ?  _(RECONNECT_TEXT) + SPACE 
                     + imports.ui.status.network.ssidToLabel(accessPoint.get_ssid()) : _(RECONNECT_TEXT) ;
                     
            wrapper.reconnectItem.actor.visible 
                     = (state == NM.DeviceState.DISCONNECTED || state == NM.DeviceState.DISCONNECTING ||showReconnect);
                         // && (this._activeConnections[device] != null);
         } 
     },
        
    _deviceRemoved : function(client, device) {
    	if (device.get_device_type() != NM.DeviceType.WIFI) {
            return;
        }
        if(this._activeConnections && this._activeConnections[device]) {
        	this._activeConnections[device] = null;
        }
    	
    	if(this._accessPoints && this._accessPoints[device]) {
    		this._accessPoints[device] = null;
    	}
        
        if (!device._delegate) {
    		return;
    	}
    	
    	let wrapper = device._delegate;
        if (wrapper.disconnectItem) {
        	wrapper.disconnectItem.destroy();
        	wrapper.disconnectItem = null;
        }

        if (wrapper.reconnectItem) {
            wrapper.reconnectItem.destroy();
            wrapper.reconnectItem = null;
        }
        
        this._signalManager.disconnectBySource(device);
    },
    
    _setDevicesReconnectVisibility : function()  {
    	if (this._network && this._network._nmDevices) {
            this._network._nmDevices.forEach(function(device) {
            	this._setReconnectVisibility(device, device.state);   
            }, this);
        }
    },

    destroy : function() {
        if (this._network && this._network._nmDevices) {
            this._network._nmDevices.forEach(function(device) {
                this._stateChanged(device, device.state, device.state, "");
            }, this);
        }
        this._signalManager.disconnectAll();
    }
});

let _instance;
function enable() {
    _instance = new WifiDisconnector();
}

function disable() {
    _instance.destroy();
    _instance = null;
}

