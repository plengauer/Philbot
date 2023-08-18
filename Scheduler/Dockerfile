FROM ruby:3.0
ARG APPLICATION_VERSION
WORKDIR /application

COPY Gemfile ./
RUN bundle install
COPY ./lib/* ./

ENV SERVICE_NAME="Philbot Scheduler"
ENV SERVICE_NAME=$APPLICATION_VERSION
CMD exec ruby scheduler.rb
