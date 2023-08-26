package eu.philbot;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.*;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public class DiscordGateway2HTTPMaster {
    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", Integer.parseInt(System.getenv("PORT"))), 10);
        server.createContext("/ping", ObservableHttpHandler.observe(DiscordGateway2HTTPMaster::servePing));
        server.createContext("/gateway/update", ObservableHttpHandler.observe(DiscordGateway2HTTPMaster::serveUpdate));
        server.createContext("/gateway/config", ObservableHttpHandler.observe(DiscordGateway2HTTPMaster::serveConfig));
        server.start();
    }

    private static void servePing(HttpExchange exchange) throws IOException {
        if (!exchange.getRequestMethod().equals("GET")) {
            error(exchange, 405);
            return;
        }
        String response = "pong";
        exchange.getResponseHeaders().add("content-type", "text/plain");
        exchange.sendResponseHeaders(200, response.length());
        writeResponseBody(exchange, response);
        exchange.close();
    }

    private static void serveUpdate(HttpExchange exchange) throws IOException {
        if (!exchange.getRequestMethod().equals("POST")) {
            error(exchange, 405);
            return;
        }
        updateDesiredShardCount();
        exchange.sendResponseHeaders(200, 0);
        exchange.close();
    }

    private static void serveConfig(HttpExchange exchange) throws IOException {
        if (!exchange.getRequestMethod().equals("POST")) {
            error(exchange, 405);
            return;
        }
        String response = computeNewConfig(new Config(readRequestBody(exchange))).toString();
        exchange.getResponseHeaders().add("content-type", "text/plain");
        exchange.sendResponseHeaders(200, response.length());
        writeResponseBody(exchange, response);
        exchange.close();
    }

    private static String readRequestBody(HttpExchange exchange) throws IOException {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(exchange.getRequestBody()))) {
            for (String line = reader.readLine(); line != null; line = reader.readLine()) {
                builder.append(line);
                builder.append("\n");
            }
        }
        return builder.toString().trim();
    }

    private static void writeResponseBody(HttpExchange exchange, String response) throws IOException {
        try (Writer writer = new OutputStreamWriter(exchange.getResponseBody())) {
            writer.write(response);
        }
    }

    private static void error(HttpExchange exchange, int error) throws IOException {
        exchange.sendResponseHeaders(error, 0);
        exchange.close();
    }

    private static final Object LOCK = new Object();
    private static volatile int SHARD_COUNT = queryDesiredShardCount();
    private static volatile Config[] CONFIGS = new Config[0];

    private static void updateDesiredShardCount() {
        synchronized(LOCK) {
            SHARD_COUNT = queryDesiredShardCount();
            CONFIGS = Arrays.stream(CONFIGS).filter(config -> config.shard_count != SHARD_COUNT).toArray(Config[]::new);
        }
    }

    private static int queryDesiredShardCount() {
        try {
            URL url = new URL("https://discord.com/api/v10/gateway/bot");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Authorization", "Bot " + System.getenv("DISCORD_API_TOKEN"));
            StringBuilder builder = new StringBuilder();
            try (BufferedReader in = new BufferedReader(new InputStreamReader(connection.getInputStream()))) {
                for (String line = in.readLine(); line != null; line = in.readLine()) {
                    builder.append(line);
                    builder.append("\n");
                }
            }
            String json = builder.toString().trim();
            String intro = "\"shards\":";
            int index = json.indexOf(intro) + intro.length();
            int count = 0;
            while (index < json.length() && Character.isDigit(json.charAt(index))) {
                count = count * 10 + (json.charAt(index) - '0');
                index += 1;
            }
            return count;
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private static Config computeNewConfig(Config current) {
        /*
         * initial boot
         * shard count changes
         * one reboots
         * one crashes
         * one hangs temporarily (and a new one is spawned)
         */
        synchronized (LOCK) {
            if (current.shard_index < 0 || current.shard_count < 0) {
                return createNewConfig(current.id);
            } else if (current.shard_count != SHARD_COUNT) {
                return createNewConfig(current.id);
            } else if (current.shard_count == SHARD_COUNT && Arrays.stream(CONFIGS).anyMatch(config -> config.id != current.id && current.shard_index == config.shard_index)) {
                return createNewConfig(current.id);
            } else if (Arrays.stream(CONFIGS).anyMatch(config -> config.id == current.id && config.shard_index == current.shard_index && config.shard_count == current.shard_count)) {
                return current;
            } else {
                List<Config> configs = Arrays.asList(CONFIGS);
                configs.add(current);
                CONFIGS = configs.toArray(Config[]::new);
                return current;
            }
        }
    }

    private static Config createNewConfig(String id) {
        synchronized(LOCK) {
            for (int shard_index = 0; shard_index < SHARD_COUNT; shard_index++) {
                final int final_shard_index = shard_index;
                if (Arrays.stream(CONFIGS).anyMatch(config -> config.shard_index == final_shard_index)) continue;
                Config newConfig = new Config(id, shard_index, SHARD_COUNT);
                List<Config> list = Arrays.stream(CONFIGS).filter(config -> config.id != newConfig.id).filter(config -> config.shard_index != newConfig.shard_index).collect(Collectors.toList());
                list.add(newConfig);
                CONFIGS = list.toArray(new Config[list.size()]);
                return newConfig;
            }
        }
        return new Config(id, -1, -1);
    }

    private static class Config {
        public final String id;
        public final int shard_index;
        public final int shard_count;

        public Config(String string) throws IOException {
            String[] tokens = string.split(";");
            if (tokens.length < 1) throw new IOException();
            this.id = tokens[0];
            this.shard_index = (tokens.length < 2 || tokens[1].equals("") || tokens[1].equals("null") || tokens[1].equals("undefined")) ? -1 : Integer.parseInt(tokens[1]);
            this.shard_count = (tokens.length < 3 || tokens[2].equals("") || tokens[2].equals("null") || tokens[2].equals("undefined")) ? -1 : Integer.parseInt(tokens[2]);
        }

        public Config(String id, int shard_index, int shard_count) {
            this.id = id;
            this.shard_index = shard_index;
            this.shard_count = shard_count;
        }

        @Override
        public String toString() {
            return id + ";" + (shard_index < 0 ? "" : shard_index) + ";" + (shard_count < 0 ? "" : shard_count);
        }
    }
}