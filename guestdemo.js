let videoengager = (function () {
    let displayName, firstName, lastName, organizationId, deploymentId, 
    veUrl, tenantId, environment, queueName, video_on = false,
    clickButtonStartLabel = 'Start video', clickButtonStopLabel = 'Stop video', 
    videoIframeHolderName = 'video-iframe-holder',
    afterGenerateInteractionDataCallback = null,
    startButtonPressed = null, 
    onError = null,
    cleanUpVideoHolder = true, connectedMembersId = [], socket;

    let KEEP_ALIVE_TIME = 10*60*1000; // keep alive time 10min
    let keepAliveTimer;
    const returnExtendedResponses = false;
    const enableDebugLogging = false;
    
    let chatId;
    let customerMemberId;
    let jwt;
    let interactionId;

    const platformClient = require("platformClient");
    const client = platformClient.ApiClient.instance;

    /**
     * a function to send typing notification. it is used to avoid 15min chat timeout 
     */
    const sendNotificationTyping = function() {
        $.ajax({
            url: `https://api.${environment}/api/v2/webchat/guest/conversations/${chatId}/members/${customerMemberId}/typing`,
            type: "POST",
            contentType: "application/json",
            beforeSend: function(xhr) {
                xhr.setRequestHeader( "Authorization", "bearer " + jwt );
            },
            success: function(data, statusCode, jqXHR) {
                console.log("successfully sent typing indicator");
            },
            error: function(err) {
                console.error(err.responseText);
            }
        });
    }

    /**
     * Configures purecloud's sdk (enables debugging, sets correct environment)
     * @param {string} client platformClient.ApiClient.instance
     * @param {string} environment purecloud environment. Example: mypurecloud.com
     * @param {boolean} returnExtendedResponses
     * @param {boolean} enableDebugLogging
     */
    const configureSDK = function (client, environment, returnExtendedResponses, enableDebugLogging) {
        client.setEnvironment(environment);
        client.setReturnExtendedResponses(returnExtendedResponses);

        if (enableDebugLogging) {
            client.setDebugLog(console.log);
        }
    };

    /**
     * Generates random GUID string
     * @returns {string} GUID
     */
    const getGuid = function() {
        function s4() {
            return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
        }

        return (
            s4() +
            s4() +
            "-" +
            s4() +
            "-" +
            s4() +
            "-" +
            s4() +
            "-" +
            s4() +
            s4() +
            s4()
        );
    };

    /**
     * Gets cookie value
     * @param {string} name cookie name
     * @returns {string|null} cookie value or undentified if cookie doesnt exists
     */
    const getCookie = function(name) {
        var pattern = new RegExp(name + "=.[^;]*");
        var matched = document.cookie.match(pattern);
        if (matched) {
            var cookie = matched[0].split("=");
            var cooki = decodeURIComponent(cookie[1]).replace(
                /"/g,
                ""
            );
            return cooki;
        }
        return null;
    };

    /**
     * Creates cookie with value and expiration time in hours
     * @param {string} name
     * @param {string} value
     * @param {number} hour time to live in hours
     */
    const setCookie = function(name, value, hour) {
        var cookieName = name;
        var cookieValue = value;
        var d = new Date();
        var time = d.getTime();
        var expireTime = time + 1000 * 60 * 60 * parseInt(hour);
        d.setTime(expireTime);
        if (hour) {
            document.cookie =
                cookieName +
                "=" +
                cookieValue +
                ";expires=" +
                d.toGMTString() +
                ";path=/";
        } else {
            document.cookie =
                cookieName + "=" + cookieValue + ";path=/";
        }
    };

    /**
     * Load videoengager ui
     * @param {string} veUrl
     * @param {string} interactionId
     * @param {string} tenantId
     */
    const loadUI = function (veUrl, tenantId) {
        let str = {
            video_on: video_on,
            sessionId: interactionId,
            hideChat: true,
            type: "initial",
            defaultGroup: "floor",
            view_widget: "4",
            offline: true,
            aa: true,
            skip_private: true,
            inichat: "false"
        };
        let encodedString = window.btoa(JSON.stringify(str));
        while (veUrl.charAt(veUrl.length-1) === "/"){
            veUrl = veUrl.substring(0,veUrl.length-1)
        }
        let url = `${veUrl}/static/popup.html?tennantId=${window.btoa(tenantId)}&params=${encodedString}`;
        $(`#${videoIframeHolderName}`).html(`<iframe width="100%" height="100%" id="videoengageriframe" allow="microphone; camera" src="${url}"></iframe>`);
    };

    /**
     * Sends interaction id
     * @param chatId
     * @param customerMemberId
     * @param interactionId
     */
    const sendInteractionId = function (chatId, customerMemberId) {
        var postData = {
            body: `{"interactionId": "${interactionId}", "displayName": "${displayName}", "firstName": "${firstName}", "lastName": "${lastName}"}`
        };

        $.ajax({
            url:
                `https://api.${environment}/api/v2/webchat/guest/conversations/${chatId}/members/${customerMemberId}/messages`,
            type: "POST",
            data: JSON.stringify(postData),
            contentType: "application/json",
            beforeSend: function(xhr) {
                xhr.setRequestHeader(
                    "Authorization",
                    "bearer " + jwt
                );
            },
            complete: function() {
                if (enableDebugLogging) {
                    console.log('successfully sent interactionId');
                }
            },
            error: function(err) {
                console.error('unable to sent interactionId');
                console.log("error", err);
            }
        });
        // schedule a typing indicator each 10min to keep chat channel opened
        keepAliveTimer = setInterval(sendNotificationTyping, KEEP_ALIVE_TIME); 
    };

    /**
     * Sets interactionId variable to interactionId (generated or using preexisting)
     */
    const setInteractionId = function () {
        interactionId = getCookie("interactionId");
        if (interactionId == undefined) {
            interactionId = getGuid();
            setCookie("interactionId", interactionId, 24);
        }
    };
    
    const generateInteractionData = function () {
      interactionId = getGuid();
      
      // $("#displayInteractionId").html(interactionId);
      // $("#displayName").html(displayName);
      // $("#firstName").html(firstName);
      // $("#lastName").html(lastName);
    }

    /**
     * Callback executed when client is successfully connected to conversation
     */
    const onConnected = function () {
        $("#clickButton").html(clickButtonStopLabel);
        $("#clickButton").attr("disabled", false);
        sendInteractionId(chatId, customerMemberId);
        loadUI(veUrl, tenantId);
    };

    /**
     * Callback executed when message event is received from mypurecloud api
     * @param data received json
     */
    const onReceivedMessageFromConversation = function (data) {
        if (
            data.eventBody &&
            data.eventBody.body &&
            data.eventBody.body.indexOf(veUrl) !== -1
        ) {
            const url = data.eventBody.body;
            $("#response").append(`<p><a href='${url}' target='videoengageriframe' class='blink_me'>Accept Incoming Video Chat</a></p>`);
        }
    };

    /**
     * can be overriden as a callback 
     * @param {chat message sender member id} senderId 
     * @param {chat message text} messageText 
     */
    var onChatMessageReceived = function(senderId, messageText) {
        
    }

    /**
     * can be overriden as a callback 
     * @param {chat message sender member id} senderId 
     * @param {chat message text} messageText  
     */
    var onChatNoticeReceived = function(senderId, messageText) {

    }

    /**
     * can be overriden as a callback 
     * @param {chat message sender member id} senderId 
     */
    var onChatMemberJoined = function(senderId) {

    }

    /**
     * can be overriden as a callback 
     * @param {chat message sender member id} senderId 
     */
    var onChatMemberLeft = function(senderId) {

    }

    var onMessageReceived = function(messageType, senderId, messageText) {
        switch(messageType) {
            case 'standard' : {
                onChatMessageReceived && onChatMessageReceived(senderId, messageText);
                break;
            }
            case 'notice' : {
                onChatNoticeReceived && onChatNoticeReceived(senderId, messageText);
                break;
            }           
            case 'member-join' : {
                onChatMemberJoined && onChatMemberJoined(senderId);
                break;
            }
            case 'member-leave' : {
                onChatMemberLeft && onChatMemberLeft(senderId);
                break;
            }
        }
    }

    /**
     * can be overriden as a callback 
     * @param {chat message typer member id} senderId 
     */
    var onTypingReceived = function(senderId) {

    }

    /**
     * can be overriden as a callback 
     */
    var onHeartbeatReceived = function() {

    }

    /**
     * can be overriden as a callback 
     */
    var onCustomerConnected = function(){
        onConnected();
    }

    /**
     * can be overriden as a callback 
     */
    var onCustomerDisconnected = function(){
        // do cleanup
        endVideo(true);
    }

    /**
     * can be overriden as a callback 
     */
    var onParticipantConnected = function(eventMemberId) {

    }

    /**
     * can be overriden as a callback 
     */
    var onParticipantDisconnected = function(eventMemberId) {

    }

    /**  
     * this part triggered on 3 cases
     * 1 - when you make a call and drop to an agent page first time
     * 2 - if your agent declined you and another agent accepted you 
     * 3 - if your agent transferred you
     * new agent requires reinitialization
    */
    var onCallingNewAgent = function(eventMemberId) {
        onConnected() 
    }

    var onStateChange = function(eventMemberState, eventMemberId) {
        // there are 3 states, CONNECTED, DISCONNECTED, ALERTING
        switch (eventMemberState) {
            // participant connected
            case 'CONNECTED': {
                // add connected participant to members array
                if (connectedMembersId.indexOf(eventMemberId) === -1) {
                    connectedMembersId.push(eventMemberId);
                }
                
                // customer connected to genesys
                if (eventMemberId === customerMemberId){
                    onCustomerConnected();
                }

                onParticipantConnected && onParticipantConnected(eventMemberId);
                break;
            }
            // participant disconnected
            case 'DISCONNECTED': {
                // remove disconnected participant from members array
                for( var i = 0; i < connectedMembersId.length; i++){ 
                    if ( connectedMembersId[i] === eventMemberId) { 
                        connectedMembersId.splice(i, 1); 
                        break;
                    }
                }

                // if customer disconnected from genesys
                if (eventMemberId === customerMemberId) {
                    onCustomerDisconnected && onCustomerDisconnected();
                }

                onParticipantDisconnected && onParticipantDisconnected(eventMemberId);
                break;
            }
            // customer call dropped into a genesys agent queue
            case 'ALERTING': {
                onCallingNewAgent && onCallingNewAgent(eventMemberId)
                break;
            }  
        }
    }

    /**
     * Callback executed when socked receives message
     * @param event socket event param
     */
     const onReceivedMessageEventFromSocket = function(event) {
        console.log("onReceivedMessageEventFromSocket started", event);
        let message, eventMemberId, eventType, eventMemberState, messageType, senderId, messageText;

        // parse received socket message into json data
        try {
            message = event && event.data ? JSON.parse(event.data) : null;
        } catch(error) {
            console.error(error);
        }
        
        // get required data with safety checks
        if (message && message.eventBody){
            if (message.eventBody.member) {
                // get event member id 
                eventMemberId = message.eventBody.member.id;
                // get event member state
                eventMemberState = message.eventBody.member.state;
            }

            // get sender id if exist
            if (message.eventBody.sender) {
                senderId = message.eventBody.sender.id;
            }
            
            // get event type, message or 
            if (message.metadata && message.metadata.type) {
                eventType = message.metadata.type;
            }

            // check if event type is a heartbeat
            if (message.eventBody.message == 'WebSocket Heartbeat') {
                eventType = 'heartbeat';
            }

            // get message type if exist
            messageType = message.eventBody.bodyType;
            messageText = message.eventBody.body;
        }

        // process socket message according event type
        switch(eventType) {
            // chat message event
            case 'message': {
                onMessageReceived && onMessageReceived(messageType, senderId, messageText);
                break;
            }
            // typing notification
            case 'typing-indicator': {
                onTypingReceived && onTypingReceived(senderId);
                break;
            }
            // connection alive indicator
            case 'heartbeat': {
                onHeartbeatReceived && onHeartbeatReceived();
                break;
            }
            // if participant state is changed
            case 'member-change': {
                onStateChange(eventMemberState, eventMemberId);
                break;
            }
         
        }
    };

    var canNotStart = () => {
      $("#clickButton").html(clickButtonStartLabel);
      $("#clickButton").attr("disabled", false);
      onError && onError({code: "all_input_fields_are_required"});
    };
    
    /**
     * Executed when clicked on start video button
     * @param interactionId
     */
    const startVideoButtonClickHandler = function () {
        if(!(displayName && firstName && lastName && queueName && organizationId 
          && deploymentId && environment && tenantId)) {
          canNotStart("all_input_fields_are_required");
          return false;
        }
        configureSDK(client, environment, returnExtendedResponses, enableDebugLogging); 
        generateInteractionData();
        afterGenerateInteractionDataCallback && afterGenerateInteractionDataCallback();
        // Create API instance
        const webChatApi = new platformClient.WebChatApi();
        const createChatBody = {
            organizationId: organizationId,
            deploymentId: deploymentId,
            routingTarget: {
                targetType: "QUEUE",
                targetAddress: queueName
            },
            memberInfo: {
                displayName: displayName,
                customFields: {
                    firstName: firstName,
                    lastName: lastName
                }
            }
        };

        // Create chat
        webChatApi
            .postWebchatGuestConversations(createChatBody)
            .then(createChatResponse => {
                let chatInfo = createChatResponse.body ? createChatResponse.body : createChatResponse;

                client.setJwt(chatInfo.jwt);

                socket = new WebSocket(chatInfo.eventStreamUri);

                chatId = chatInfo.id;
                customerMemberId = chatInfo.member.id;
                jwt = chatInfo.jwt;

                // Listen for messages
                socket.addEventListener("message", onReceivedMessageEventFromSocket);
            })
            .catch(console.error);
        return true;
    };
    
    const deleteConversation = function() {
      if(environment && chatId && customerMemberId) {
        $.ajax({
          url: `https://api.${environment}/api/v2/webchat/guest/conversations/${chatId}/members/${customerMemberId}`,
          type: "DELETE",
          beforeSend: function(xhr) {
                  xhr.setRequestHeader(
                          "Authorization",
                          "bearer " + jwt
                  );
          }
        });
      }
    };
    
    const endVideo = function(isConversationDeleted = false) {
      if(keepAliveTimer){ clearInterval(keepAliveTimer) }
      if(!isConversationDeleted) {
        deleteConversation();
      }
      $("#clickButton").html(clickButtonStartLabel);
      $("#clickButton").attr("disabled", false);
      if(cleanUpVideoHolder) {
        let iframe = document.getElementById("videoengageriframe");
        if(iframe) iframe.remove();
        $(`#${videoIframeHolderName}`).html('');
      }
      isStarted = false;
      if (socket) {socket.close()}  
    };
    
    let isStarted = false;
    const clickButtonClicked = function() {
      if(isStarted) {
        endVideo();
      } else {
        startButtonPressed && startButtonPressed();
        $("#clickButton").attr("disabled", true);
        startVideoButtonClickHandler() ? isStarted = true : isStarted = false; 
      }
    };
    
    var init = function() {
      $("#clickButton").html(clickButtonStartLabel);
    };
        
    $(document).ready(function() {
        $("#clickButton").on("click", clickButtonClicked);
        window.onbeforeunload = () => endVideo();
    });
    
    
    return {
      onChatMessageReceived: (cb) => { onChatMessageReceived = cb },
      onChatNoticeReceived: (cb) => { onChatNoticeReceived = cb },
      onChatMemberJoined: (cb) => { onChatMemberJoined = cb },
      onChatMemberLeft: (cb) => { onChatMemberLeft = cb },
      onMessageReceived: (cb) => { onMessageReceived = cb },
      onTypingReceived: (cb) => { onTypingReceived = cb },
      onHeartbeatReceived: (cb) => { onHeartbeatReceived = cb },
      onParticipantConnected: (cb) => { onParticipantConnected = cb },
      onParticipantDisconnected: (cb) => { onParticipantDisconnected = cb },
      onCustomerConnected: (cb) => { onCustomerConnected = cb },
      onCustomerDisconnected: (cb) => { onCustomerDisconnected = cb },
      onCallingNewAgent: (cb) => { onCallingNewAgent = cb },
      endCall: () => { endVideo(); },
      reinitiateCall: () => { onConnected(); },
      getCustomerMemberId: () => customerMemberId,
      getConnectedMembersId: () => connectedMembersId,

      setDisplayName: (inDisplayName) => { displayName = inDisplayName },
      setFirstName: (inFirstName) => { firstName = inFirstName },
      setLastName: (inLastName) => { lastName = inLastName },
      setOrganizationId: (inOrganizationId) => { organizationId = inOrganizationId },
      setDeploymentId: (inDeploymentId) => { deploymentId = inDeploymentId },
      setVideoengagerUrl: (inVideoengagerUrl) => { veUrl = inVideoengagerUrl },
      setTenantId: (inTenantId) => { tenantId = inTenantId },
      setEnvironment: (inEnvironment) => { environment = inEnvironment },
      setQueue: (inQueue) => { queueName = inQueue },
      init: () => init(),
      setVideoOn: (inVideoOn) => { video_on = inVideoOn },
      setButtonStartLabel: (inStartLabel) => { clickButtonStartLabel = inStartLabel },
      setButtonEndLabel: (inEndLabel) => { clickButtonStopLabel = inEndLabel },
      setVideoIframeHolderName: (inVideoIframeHolderName) => { videoIframeHolderName = inVideoIframeHolderName},
      setCleanUpVideoHolder: (inCleanUpVideoHolder) => { cleanUpVideoHolder = inCleanUpVideoHolder },
      getInteractionId: () => interactionId,
      getDisplayName: () => displayName,
      getFirstName: () => firstName,
      getLastName: () => lastName,
      //callbacks
      afterGenerateInteractionDataCallback: (cb) => { 
        afterGenerateInteractionDataCallback = cb 
      },
      startButtonPressed: (cb) => {
        startButtonPressed = cb
      },
      onError: (cb) => {
        onError = cb;
      }
    };
})();
