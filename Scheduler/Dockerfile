FROM ruby:latest
ARG APPLICATION_VERSION
WORKDIR /application

COPY Gemfile ./
RUN bundle install
COPY ./lib/* ./

CMD exec ruby scheduler.rb
