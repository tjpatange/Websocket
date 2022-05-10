/**
* Provide service at a default port.
*/
var listen_port = 1337;
/**
* Create an HTTP server to handle regular web requests.
*/
var http = require("http"); // HTTP service
var url = require("url"); // URL parser
var fs = require("fs"); // FileSystem
var httpServer = http.createServer(onHttpRequest).listen(listen_port);
/**
* Handle socket.io connections.
*/
var io = require("socket.io")(httpServer);
io.on("connection", onSocketConnect);

/**
 * Deal with data from monitor.p and initial client requests
 */
function onHttpRequest(request, response) {
    var parsedUrl = url.parse(request.url);
    var pathName = parsedUrl.pathname || "";
    var pathArray = pathName.split("/"); // Convert to array.
    var pathVal = (pathArray.length > 1) ? pathArray[1] : "";
    switch(request.method) {
        case "GET":
            doGet(pathVal, request, response);
            break;
        case "POST":
            doPost(pathVal, request, response);
            break;
        default:
            // Unsupported HTTP method.
            response.writeHeader(405, "Method Not Allowed", {"Content-Type": "text/plain"});
            response.end();
    }
}

/**
 * GET - look which file has been requested and serve up the HTML document
 */
function doGet(pathVal, request, response){
    var filename = null;
    switch(pathVal) {
        case "":
        case "client.html":
            // Serve the client HTML file on GET.
            filename = "/client.html";
            break;
        default:
            // File not found for serving.
            response.writeHeader(404, "Not Found", {"Content-Type": "text/plain"});
            response.end();
    }
    if (filename) {
        fs.readFile(__dirname + filename, "utf8", function(error, content) {
            response.writeHeader(200, "OK", {"Content-Type": "text/html"});
            response.end(content);
        });
    }
}



function doPost(pathVal, request, response) {
    /**
    * Accepting payload for POST
    */
    var uuid = pathVal; // In this case the path value is a UUID.
    var postData = ""; // Store the body data on POST.
    var count = 1;
    request.on("data", function(chunk) {
        postData += chunk;
        if (postData.length > 1e6) {
            postData = ""; // Abort if data appears to be a [malicious] flood.
            response.writeHeader(413, {"Content-Type": "text/plain"}).end();
            request.connection.destroy();
        }
        count++;
    }); // on data

    request.on("end", function() {
        var responseBody = {response: "Broadcast Sent: " + uuid};
        if (postData != "") {
            var jsonObj = null;
            try {
                jsonObj = JSON.parse(postData);
            } 
            catch(parseErr) {
                responseBody = {response: "JSON Error: " + parseErr.message};
            }
            // Add the UUID for socket broadcast.
            if (harvesters.indexOf(uuid) < 0) {
                harvesters.push(uuid);
            }
            // Broadcast to clients on socket server, based on UUID.
            if (jsonObj && io.sockets.clients(uuid).length > 0) {
                var room = io.sockets.in(uuid);
                room.emit("broadcast-data", jsonObj.activityData);
            }
        } // postData

        // Prepare response body with optional commands.
        if (commands[uuid]) {
            responseBody.commands = commands[uuid];
            delete commands[uuid];
        }
        // End the response with a message.
        var responseJSON = JSON.stringify(responseBody);
        var responseHeaders = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Content-Length": Buffer.byteLength(responseJSON)
        };
        response.writeHeader(200, "OK", responseHeaders);
        response.write(responseJSON);
        response.end(); 
    });
}


function onSocketConnect(socket) {
    /**
    * Handle requests to listen for broadcast consoles
    */
    socket.on("listen", function (uuid, callback) {
        // If the uuid looks legit, subscribe.
        if (uuid.length == 40) {
            socket.uuid = uuid; // Save UUID on socket.
            socket.join(uuid); // Join a "room" for UUID.
            // Callback to the listener with a successful flag.
            callback(true);
        } else {
            // If the uuid is not available, reject the request to listen.
            callback(false);
        }
    }); // on listen
    /**
 * Handle requests for new commands back to harvester
 */
    socket.on("send-command", function (uuid, command) {
        // If the uuid is being broadcast, add to queue.
        if (harvesters.indexOf(uuid) >= 0) {
            if (commands[uuid] && commands[uuid] instanceof Array) {
                // Queued commands pending, add to existing list.
                if (commands[uuid].indexOf(command) == -1) {
                    // Prevent adding duplicate commands.
                    commands[uuid].push(command);
                }
            } else {
                // No queued commands, create new queue for uuid.
                commands[uuid] = [command];
            }
        }
    }); // on send-command
}